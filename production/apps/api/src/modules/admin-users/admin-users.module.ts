import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller.js';

@Module({ controllers: [AdminUsersController] })
export class AdminUsersModule {}
