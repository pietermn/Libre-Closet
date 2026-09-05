import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigService } from '@nestjs/config';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, ConfigService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('index', () => {
    it('redirects the root route to login', () => {
      const reply = { redirect: jest.fn() } as any;

      appController.index(reply);

      expect(reply.redirect).toHaveBeenCalledWith('/auth/login', 302);
    });
  });
});
