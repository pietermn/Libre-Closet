import {
  Entity,
  OneToOne,
  PrimaryKey,
  Property,
  type Ref,
} from '@mikro-orm/core';
import { User } from './user.entity';

@Entity()
export class PasswordReset {
  @PrimaryKey()
  public id!: number;

  @Property()
  public pin!: string;

  /** SHA-256 hash of the reset code; the code itself is never persisted. */
  @Property({ nullable: true })
  public expiresAt?: Date;

  @Property({ nullable: true })
  public usedAt?: Date;

  @OneToOne({
    entity: () => User,
    nullable: false,
    ref: true,
    mappedBy: 'passwordReset',
  })
  public user!: Ref<User>;
}
