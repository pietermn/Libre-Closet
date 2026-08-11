import { Migration } from '@mikro-orm/migrations';

export class Migration20260812120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table \`password_reset\` add column \`expires_at\` datetime null;`);
    this.addSql(`alter table \`password_reset\` add column \`used_at\` datetime null;`);
  }
}
