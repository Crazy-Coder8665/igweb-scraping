import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity()
@Index(['hashtag'])
@Index(['influencerName'])
export class TikTokPost {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  description: string;

  @Column()
  videoUrl: string;

  @Column()
  likeCount: number;

  @Column()
  influencerName: string;

  @Column()
  hashtag: string;

  @Column('jsonb', { nullable: true })
  contactInfo: {
    [key: string]: {
      emails: string[];
      phones: string[];
      addresses: string[];
      socialMediaLinks?: string[];
      names?: string[];
      organizations?: string[];
    };
  };
} 