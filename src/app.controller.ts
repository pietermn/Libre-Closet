import { Controller, Get, Logger, Render, Req, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { I18n, I18nContext } from 'nestjs-i18n';
import { FastifyReply, FastifyRequest } from 'fastify';

@Controller()
export class AppController {
  private logger = new Logger(AppController.name);

  constructor(private readonly appService: AppService) {}

  @Get()
  index(@Res() reply: FastifyReply): void {
    reply.redirect('/auth/login', 302);
  }

  @Get('privacy')
  @Render('privacy')
  privacy(@I18n() i18n: I18nContext): any {
    return {
      pageTitle: i18n.t('lang.PRIVACY_TITLE'),
      ogTitle: i18n.t('lang.PRIVACY_OG_TITLE'),
      ogDescription: i18n.t('lang.PRIVACY_OG_DESC'),
    };
  }

  @Get('about')
  @Render('about')
  about(@I18n() i18n: I18nContext): any {
    return {
      pageTitle: i18n.t('lang.ABOUT_TITLE'),
      ogTitle: i18n.t('lang.ABOUT_OG_TITLE'),
      ogDescription: i18n.t('lang.ABOUT_OG_DESC'),
    };
  }

  @Get('terms')
  @Render('terms')
  terms(@I18n() i18n: I18nContext): any {
    return {
      pageTitle: i18n.t('lang.TERMS_TITLE'),
      ogTitle: i18n.t('lang.TERMS_OG_TITLE'),
      ogDescription: i18n.t('lang.TERMS_OG_DESC'),
    };
  }

  @Get('offline.html')
  @Render('offline')
  getOffline() {}

  @Get('.well-known/*')
  well_known() {
    return {}; // Just return empty object
  }

  @Get('sitemap.xml')
  sitemap(@Req() req: FastifyRequest, @Res() reply: FastifyReply): void {
    const protocol =
      (req.headers['x-forwarded-proto'] as string) ?? req.protocol;
    const host = (req.headers['x-forwarded-host'] as string) ?? req.host;
    const baseUrl = `${protocol}://${host}`;
    reply.header('Content-Type', 'application/xml; charset=utf-8');
    reply.send(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/auth/register</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/auth/login</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/privacy</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${baseUrl}/about</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${baseUrl}/terms</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>`,
    );
  }
}
