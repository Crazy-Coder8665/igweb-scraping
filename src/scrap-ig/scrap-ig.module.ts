import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScrapIgService } from './scrap-ig.service';
import { ScrapIgController } from './scrap-ig.controller';
import { InstagramPost } from '../entities/instagram-post.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InstagramPost])],
  controllers: [ScrapIgController],
  providers: [ScrapIgService],
  exports: [ScrapIgService],
})
export class ScrapIgModule { } 