import {
  EntityRepository,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { BadRequestException } from '@nestjs/common';
import {
  SharePermission,
  WardrobeShare,
} from '../dal/entity/wardrobe-share.entity';
import { User } from '../dal/entity/user.entity';
import { WardrobeShareService } from './wardrobe-share.service';

describe('WardrobeShareService invite acceptance', () => {
  async function acceptWithFlushError(error: Error) {
    const repository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({
          grantor: { id: 1 },
          permission: SharePermission.VIEW,
        })
        .mockResolvedValueOnce(null),
      getEntityManager: () => ({ flush: jest.fn().mockRejectedValue(error) }),
    } as unknown as EntityRepository<WardrobeShare>;
    return new WardrobeShareService(
      repository,
      {} as EntityRepository<User>,
    ).acceptInvite('invite-token', 2);
  }

  it('reports a duplicate access race as a useful client error', async () => {
    const error = new UniqueConstraintViolationException(
      new Error('duplicate access'),
    );
    await expect(acceptWithFlushError(error)).rejects.toEqual(
      new BadRequestException('You already have access to this wardrobe.'),
    );
  });

  it('preserves unrelated database failures', async () => {
    const error = new Error('Database unavailable');
    await expect(acceptWithFlushError(error)).rejects.toBe(error);
  });
});
