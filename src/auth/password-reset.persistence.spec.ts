import { MikroORM } from '@mikro-orm/better-sqlite';
import { JwtService } from '@nestjs/jwt';
import { User } from '../dal/entity/user.entity';
import { PasswordReset } from '../dal/entity/passwordReset.entity';
import { EmailService } from '../email/email.service';
import { AuthService } from './auth.service';

describe('Password reset persistence', () => {
  it('creates and links the first reset, then reuses it on a later request', async () => {
    const orm = await MikroORM.init({
      entities: [User, PasswordReset],
      dbName: ':memory:',
    });
    try {
      await orm.schema.createSchema();
      const em = orm.em.fork();
      const user = Object.assign(new User(), {
        email: 'test@example.test',
        password: 'test-hash',
      });
      await em.persistAndFlush(user);
      const sendEmailFromPrimaryAddress = jest
        .fn()
        .mockResolvedValue(undefined);
      const service = new AuthService(
        em.getRepository(User),
        {} as JwtService,
        em,
        { sendEmailFromPrimaryAddress } as unknown as EmailService,
        em.getRepository(PasswordReset),
      );
      await service.sendPasswordResetEmail('test@example.test');
      em.clear();
      const loaded = await em.findOneOrFail(User, user.id, {
        populate: ['passwordReset'],
      });
      expect(loaded.passwordReset.id).toBeDefined();
      expect(loaded.passwordReset.$.pin).toMatch(/^[a-f0-9]{64}$/);
      const firstId = loaded.passwordReset.id;
      await service.sendPasswordResetEmail('test@example.test');
      em.clear();
      const updated = await em.findOneOrFail(User, user.id, {
        populate: ['passwordReset'],
      });
      expect(updated.passwordReset.id).toBe(firstId);
      expect(await em.count(PasswordReset)).toBe(1);
      expect(sendEmailFromPrimaryAddress).toHaveBeenCalledTimes(2);
    } finally {
      await orm.close(true);
    }
  });
});
