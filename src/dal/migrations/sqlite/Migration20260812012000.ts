import { Migration } from '@mikro-orm/migrations';

export class Migration20260812012000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table \`mcp_oauth_client\` (\`id\` integer not null primary key autoincrement, \`client_id\` text not null, \`name\` text not null, \`redirect_uris\` json not null, \`created_at\` datetime not null);`);
    this.addSql(`create unique index \`mcp_oauth_client_client_id_unique\` on \`mcp_oauth_client\` (\`client_id\`);`);
    this.addSql(`create table \`mcp_authorization_code\` (\`id\` integer not null primary key autoincrement, \`code_hash\` text not null, \`redirect_uri\` text not null, \`code_challenge\` text not null, \`scopes\` json not null, \`resource\` text not null, \`expires_at\` datetime not null, \`consumed_at\` datetime null, \`client_id\` integer not null, \`user_id\` integer not null, constraint \`mcp_authorization_code_client_id_foreign\` foreign key(\`client_id\`) references \`mcp_oauth_client\` (\`id\`) on delete cascade on update cascade, constraint \`mcp_authorization_code_user_id_foreign\` foreign key(\`user_id\`) references \`user\` (\`id\`) on delete cascade on update cascade);`);
    this.addSql(`create unique index \`mcp_authorization_code_code_hash_unique\` on \`mcp_authorization_code\` (\`code_hash\`);`);
    this.addSql(`create index \`mcp_authorization_code_client_id_index\` on \`mcp_authorization_code\` (\`client_id\`);`);
    this.addSql(`create index \`mcp_authorization_code_user_id_index\` on \`mcp_authorization_code\` (\`user_id\`);`);
    this.addSql(`create table \`mcp_token\` (\`id\` integer not null primary key autoincrement, \`token_hash\` text not null, \`type\` text not null, \`scopes\` json not null, \`resource\` text not null, \`expires_at\` datetime not null, \`revoked_at\` datetime null, \`created_at\` datetime not null, \`client_id\` integer not null, \`user_id\` integer not null, constraint \`mcp_token_client_id_foreign\` foreign key(\`client_id\`) references \`mcp_oauth_client\` (\`id\`) on delete cascade on update cascade, constraint \`mcp_token_user_id_foreign\` foreign key(\`user_id\`) references \`user\` (\`id\`) on delete cascade on update cascade);`);
    this.addSql(`create unique index \`mcp_token_token_hash_unique\` on \`mcp_token\` (\`token_hash\`);`);
    this.addSql(`create index \`mcp_token_client_id_index\` on \`mcp_token\` (\`client_id\`);`);
    this.addSql(`create index \`mcp_token_user_id_index\` on \`mcp_token\` (\`user_id\`);`);
    this.addSql(`create table \`mcp_audit_log\` (\`id\` integer not null primary key autoincrement, \`tool\` text not null, \`outcome\` text not null, \`created_at\` datetime not null, \`user_id\` integer not null, \`client_id\` integer null, constraint \`mcp_audit_log_user_id_foreign\` foreign key(\`user_id\`) references \`user\` (\`id\`) on delete cascade on update cascade, constraint \`mcp_audit_log_client_id_foreign\` foreign key(\`client_id\`) references \`mcp_oauth_client\` (\`id\`) on delete set null on update cascade);`);
    this.addSql(`create index \`mcp_audit_log_user_id_index\` on \`mcp_audit_log\` (\`user_id\`);`);
    this.addSql(`create index \`mcp_audit_log_client_id_index\` on \`mcp_audit_log\` (\`client_id\`);`);
  }
}
