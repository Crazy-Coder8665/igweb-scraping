import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('instagram_posts')
@Index('idx_influencer_name', ['influencerName'])
@Index('idx_hashtag_name', ['hashtag'])
export class InstagramPost {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: true })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'like_count' })
  likeCount: number;

  @Column({ name: 'video_url' })
  videoUrl: string;

  @Column({ name: 'influencer_name' })
  influencerName: string;

  @Column({ nullable: true })
  email: string;

  @Column()
  hashtag: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
} 