import { Migration } from '@mikro-orm/migrations';

export class Migration20260812012000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "mcp_oauth_client" ("id" serial primary key, "client_id" varchar(255) not null, "name" varchar(255) not null, "redirect_uris" jsonb not null, "created_at" timestamptz not null);`);
    this.addSql(`alter table "mcp_oauth_client" add constraint "mcp_oauth_client_client_id_unique" unique ("client_id");`);
    this.addSql(`create table "mcp_authorization_code" ("id" serial primary key, "code_hash" varchar(255) not null, "redirect_uri" varchar(255) not null, "code_challenge" varchar(255) not null, "scopes" jsonb not null, "resource" varchar(255) not null, "expires_at" timestamptz not null, "consumed_at" timestamptz null, "client_id" int not null, "user_id" int not null);`);
    this.addSql(`alter table "mcp_authorization_code" add constraint "mcp_authorization_code_client_id_foreign" foreign key ("client_id") references "mcp_oauth_client" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "mcp_authorization_code" add constraint "mcp_authorization_code_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "mcp_authorization_code" add constraint "mcp_authorization_code_code_hash_unique" unique ("code_hash");`);
    this.addSql(`create index "mcp_authorization_code_client_id_index" on "mcp_authorization_code" ("client_id");`);
    this.addSql(`create index "mcp_authorization_code_user_id_index" on "mcp_authorization_code" ("user_id");`);
    this.addSql(`create table "mcp_token" ("id" serial primary key, "token_hash" varchar(255) not null, "type" varchar(255) not null, "scopes" jsonb not null, "resource" varchar(255) not null, "expires_at" timestamptz not null, "revoked_at" timestamptz null, "created_at" timestamptz not null, "client_id" int not null, "user_id" int not null);`);
    this.addSql(`alter table "mcp_token" add constraint "mcp_token_client_id_foreign" foreign key ("client_id") references "mcp_oauth_client" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "mcp_token" add constraint "mcp_token_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "mcp_token" add constraint "mcp_token_token_hash_unique" unique ("token_hash");`);
    this.addSql(`create index "mcp_token_client_id_index" on "mcp_token" ("client_id");`);
    this.addSql(`create index "mcp_token_user_id_index" on "mcp_token" ("user_id");`);
    this.addSql(`create table "mcp_audit_log" ("id" serial primary key, "tool" varchar(255) not null, "outcome" varchar(255) not null, "created_at" timestamptz not null, "user_id" int not null, "client_id" int null);`);
    this.addSql(`alter table "mcp_audit_log" add constraint "mcp_audit_log_user_id_foreign" foreign key ("user_id") references "user" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "mcp_audit_log" add constraint "mcp_audit_log_client_id_foreign" foreign key ("client_id") references "mcp_oauth_client" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "mcp_audit_log_user_id_index" on "mcp_audit_log" ("user_id");`);
    this.addSql(`create index "mcp_audit_log_client_id_index" on "mcp_audit_log" ("client_id");`);
  }
}
