import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InstagramPost } from './entities/instagram-post.entity';
import { TikTokPost } from './entities/tiktok-post.entity';
import { ScrapIgModule } from './scrap-ig/scrap-ig.module';
import { ScrapTtModule } from './scrap-tt/scrap-tt.module';
import { databaseConfig } from './config/database.config';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseConfig),
    ScrapIgModule,
    ScrapTtModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
