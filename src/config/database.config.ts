import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { config } from 'dotenv';
import { InstagramPost } from '../entities/instagram-post.entity';
import { TikTokPost } from 'src/entities/tiktok-post.entity';

config();

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'social_scraper',
  entities: [InstagramPost, TikTokPost],
  synchronize: process.env.NODE_ENV !== 'production',
}; 