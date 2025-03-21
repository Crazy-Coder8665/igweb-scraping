import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InstagramPost } from './entities/instagram-post.entity';
import { ScrapIgModule } from './scrap-ig/scrap-ig.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'instagram_scraper',
      entities: [InstagramPost],
      synchronize: true,
    }),
    ScrapIgModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
