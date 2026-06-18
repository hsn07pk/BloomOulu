import { Module } from '@nestjs/common';
import { InstagramController } from './instagram.controller.js';

@Module({ controllers: [InstagramController] })
export class InstagramModule {}
