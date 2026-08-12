import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '../dal/entity/user.entity';
import * as bcrypt from 'bcryptjs';
import { ChangePasswordDto } from './dto/changePassword.dto';
import { Payload } from './dto/payload.dto';
import { EmailService } from '../email/email.service';
import { PasswordReset } from '../dal/entity/passwordReset.entity';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ResetPasswordDto } from './dto/resetPassword.dto';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class AuthService {
  private logger = new Logger(AuthService.name);
  private readonly passwordResetTemplate: Handlebars.TemplateDelegate;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
    private jwtService: JwtService,
    private readonly em: EntityManager,
    private emailService: EmailService,
    @InjectRepository(PasswordReset)
    private passwordResetRepository: EntityRepository<PasswordReset>,
  ) {
    this.passwordResetTemplate = Handlebars.compile(
      readFileSync(
        join(__dirname, '..', '..', 'views', 'email', 'password-reset.hbs'),
        'utf-8',
      ),
    );
  }

  async register(email: string, password: string): Promise<string> {
    const existingUser = await this.userRepository.findOne({ email });
    if (existingUser) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = this.userRepository.create({
      email,
      password: hashedPassword,
    } as User);
    await this.em.persistAndFlush(user);

    return this.jwtService.signAsync({
      userId: user.id,
      email: user.email,
      pwf: hashedPassword.slice(-8),
    } as Payload);
  }

  async signIn(email: string, password: string): Promise<string> {
    const user = await this.userRepository.findOneOrFail({ email });
    const valid = await bcrypt.compare(password, user?.password);
    if (!valid) {
      throw new UnauthorizedException();
    }
    return this.jwtService.signAsync({
      userId: user.id,
      email: user.email,
      pwf: user.password.slice(-8),
    } as Payload);
  }

  public async verifyPwf(payload: Payload) {
    // Verify password fingerprint, tokens invalidate on password change or if missing
    const user = await this.userRepository.findOneOrFail({
      id: payload.userId,
    });
    if (user.password.slice(-8) !== payload.pwf) {
      throw new UnauthorizedException();
    }
  }

  public async changePassword(userId: any, details: ChangePasswordDto) {
    const user = await this.userRepository.findOneOrFail({ id: userId });

    if (await bcrypt.compare(details.oldPassword, user.password)) {
      const newHashedPassword = await bcrypt.hash(details.newPassword, 12);
      user.password = newHashedPassword;
      return await this.em.persistAndFlush(user);
    }
  }

  public async changeEmail(userId: any, newEmail: string) {
    const user = await this.userRepository.findOneOrFail({ id: userId });
    user.email = newEmail;
    await this.em.persistAndFlush(user);
  }

  async deleteUser(userId: any) {
    const user = await this.userRepository.findOneOrFail({ id: userId });
    await this.em.removeAndFlush(user);
  }

  public async resetPassword(details: ResetPasswordDto): Promise<boolean> {
    const user = await this.userRepository.findOne({ email: details.email });
    if (!user) return false;

    const passwordReset = await user.passwordReset.load();
    if (!passwordReset || passwordReset.usedAt || !passwordReset.expiresAt) {
      return false;
    }

    const suppliedHash = this.hashResetCode(details.resetCode);
    const valid =
      passwordReset.expiresAt.getTime() > Date.now() &&
      timingSafeEqual(
        Buffer.from(passwordReset.pin, 'hex'),
        Buffer.from(suppliedHash, 'hex'),
      );
    if (!valid) return false;

    user.password = await bcrypt.hash(details.password, 12);
    passwordReset.usedAt = new Date();
    await this.em.persistAndFlush([user, passwordReset]);
    return true;
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    const user = await this.userRepository.findOne({ email });
    // Deliberately succeed for unknown email addresses to avoid account enumeration.
    if (!user?.email) return;

    const pin = randomBytes(24).toString('base64url');
    const existingReset = await user.passwordReset.load();
    const passwordReset =
      existingReset ?? this.passwordResetRepository.create();
    passwordReset.pin = this.hashResetCode(pin);
    passwordReset.expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    passwordReset.usedAt = undefined;

    // User owns the foreign key (`user.password_reset_id`). Setting the
    // inverse-side relation on PasswordReset alone does not persist it.
    if (!existingReset) user.passwordReset.set(passwordReset);
    await this.em.persistAndFlush(user);

    await this.emailService.sendEmailFromPrimaryAddress({
      to: user.email,
      subject: `Password reset for ${user.email}`,
      text: `Hello, ${user.email}, please paste in the following code to reset your password: ${pin}`,
      html: this.passwordResetTemplate({ email: user.email, pin }),
    });
  }

  private hashResetCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
}
