import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScrapTtService } from './scrap-tt.service';
import { ScrapTtController } from './scrap-tt.controller';
import { TikTokPost } from '../entities/tiktok-post.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TikTokPost])],
  controllers: [ScrapTtController],
  providers: [ScrapTtService],
})
export class ScrapTtModule { } 