import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Page } from "puppeteer";
import { TikTokPost } from '../entities/tiktok-post.entity';
import { get } from 'lodash';
import puppeteerExtra from 'puppeteer-extra';
import { ScrapCommonService } from '../common/scrap-common.service';

@Injectable()
export class ScrapTtService extends ScrapCommonService {
  private readonly MAX_POSTS = 10;

  constructor(
    @InjectRepository(TikTokPost)
    private tiktokPostRepository: Repository<TikTokPost>,
  ) {
    super();
  }

  private async getExistingPosts(hashtag: string): Promise<Map<string, TikTokPost>> {
    const existingPosts = await this.tiktokPostRepository.find({
      where: { hashtag },
      select: ['id', 'videoUrl', 'likeCount', 'influencerName']
    });

    return new Map(existingPosts.map(post => [post.videoUrl, post]));
  }

  private async saveNewPosts(posts: TikTokPost[], hashtag: string, existingPosts: Map<string, TikTokPost>): Promise<TikTokPost[]> {
    const savedPosts: TikTokPost[] = [];
    const postsToUpdate: TikTokPost[] = [];
    const postsToCreate: TikTokPost[] = [];

    for (const post of posts) {
      const existingPost = existingPosts.get(post.videoUrl);

      if (existingPost) {
        if (post.likeCount > existingPost.likeCount) {
          post.id = existingPost.id;
          postsToUpdate.push(post);
        }
      } else {
        postsToCreate.push({
          ...post,
          hashtag
        });
      }
    }

    try {
      if (postsToCreate.length > 0) {
        const newPosts = await this.tiktokPostRepository.save(postsToCreate);
        savedPosts.push(...newPosts);
      }

      if (postsToUpdate.length > 0) {
        const updatedPosts = await this.tiktokPostRepository.save(postsToUpdate);
        savedPosts.push(...updatedPosts);
      }

      return savedPosts;
    } catch (error) {
      console.error('Error saving posts to database:', error);
      throw new Error('Failed to save posts to database');
    }
  }

  private parseViewCount(views: string): number {
    const num = parseFloat(views.replace(/[^0-9.]/g, ''));
    if (views.includes('M')) return num * 1000000;
    if (views.includes('K')) return num * 1000;
    return num;
  }

  private getTopUniqueInfluencerPosts(posts: TikTokPost[]): TikTokPost[] {
    const influencerMap = new Map<string, TikTokPost>();

    posts.forEach(post => {
      const existingPost = influencerMap.get(post.influencerName);
      if (!existingPost || post.likeCount > existingPost.likeCount) {
        influencerMap.set(post.influencerName, post);
      }
    });

    const uniquePosts = Array.from(influencerMap.values())
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, this.MAX_POSTS);

    console.log(`Found ${uniquePosts.length} unique influencers with top posts`);
    return uniquePosts;
  }

  async scrapTT(hashtag: string) {
    const browser = await puppeteerExtra.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });

    try {
      const existingPosts = await this.getExistingPosts(hashtag);
      console.log(`Found ${existingPosts.size} existing posts for hashtag #${hashtag}`);

      const page = await browser.newPage();
      await this.setupPage(page);

      await page.goto(`https://www.tiktok.com/search?q=${hashtag}`, { waitUntil: 'networkidle0', timeout: this.TIMEOUT });
      await this.randomDelay(100, 500);

      await page.waitForSelector('div[role="tabpanel"]', { timeout: this.TIMEOUT });

      const allScrapedPosts: TikTokPost[] = [];
      let postsProcessed = 0;
      let scrollAttempts = 0;
      let lastPostCount = 0;

      while (scrollAttempts < this.MAX_SCROLL_ATTEMPTS) {
        try {
          if (Math.random() > 0.7) {
            await this.randomMouseMovements(page);
          }

          let post = null;
          const posts = await page.$$('div[class*="DivItemContainerForSearch"]');
          if (postsProcessed < posts.length) {
            await posts[postsProcessed].evaluate(node => {
              node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            await this.delay(500);
            post = posts[postsProcessed];
          }

          if (!post) {
            if (allScrapedPosts.length === lastPostCount) {
              console.log('No new posts found after scrolling');
              break;
            }

            await this.randomScrolling(page);
            scrollAttempts++;
            lastPostCount = allScrapedPosts.length;
            continue;
          }

          const data = await post.evaluate(node => {
            return {
              description: node.querySelector('div[data-e2e="search-card-video-caption"]')?.textContent || '',
              profileUrl: node.querySelector('a[data-e2e="search-card-user-link"]')?.getAttribute('href') || '',
              influencerName: node.querySelector('p[data-e2e="search-card-user-unique-id"]')?.textContent || '',
              views: node.querySelector('strong[data-e2e="video-views"]')?.textContent || '',
            }
          });

          const contactData: any = {};

          const page2 = await browser.newPage();
          try {
            await this.setupPage(page2);

            await page2.goto(`https://www.tiktok.com${data.profileUrl}`, { waitUntil: 'networkidle0', timeout: this.TIMEOUT });

            await page2.waitForSelector('div[class*="CreatorPageHeader"]', { timeout: this.TIMEOUT });

            const bioLinks = await page2.evaluate(() => {
              const links: { href: string; text: string }[] = [];
              const bioElement = document.querySelector('div[class*="DivShareLinks"]');
              if (!bioElement) return [];

              const extractedLinks = Array.from(bioElement.querySelectorAll('a'));
              for (const link of extractedLinks) {
                links.push({ href: link.getAttribute('href') || '', text: link.textContent || '' });
              }

              return links;
            });

            bioLinks.push({ href: `https://www.tiktok.com${data.profileUrl}`, text: '' });

            for (const link of bioLinks) {
              if (!link.href) continue;

              try {
                await page2.goto(link.href, { waitUntil: 'networkidle0', timeout: this.TIMEOUT });
                await this.randomDelay(100, 500);

                const pageText = await page2.evaluate(() => document.body.innerText);
                const contactInfo = this.extractContactInfo(pageText);
                const socialMediaLinks = await this.extractSocialLinks(page2);

                contactData[link.href] = {
                  emails: get(contactInfo, 'emails', []),
                  phones: get(contactInfo, 'phones', []),
                  addresses: get(contactInfo, 'addresses', []),
                  ...(link.href === `https://www.tiktok.com${data.profileUrl}` ? {} : {
                    socialMediaLinks: socialMediaLinks || [],
                    names: get(contactInfo, 'names', []),
                    organizations: get(contactInfo, 'organizations', []),
                  })
                }
              } catch (error) {
                console.error(`Error checking link ${link.href}:`, error);
                continue;
              }
            }

            await page2.close();
          } catch (error) {

            await page2.close();
          }

          const box = await post.boundingBox();
          if (box) {
            await page.mouse.move(
              box.x + box.width / 2 + (Math.random() * 20 - 10),
              box.y + box.height / 2 + (Math.random() * 20 - 10),
              { steps: 25 }
            );
            await this.randomDelay(200, 500);
          }

          await this.randomDelay(1500, 2500);

          const processedPost: TikTokPost = {
            description: data.description,
            videoUrl: `https://www.tiktok.com${data.profileUrl}`,
            likeCount: this.parseViewCount(data.views),
            influencerName: data.influencerName,
            hashtag,
            contactInfo: contactData
          } as TikTokPost;

          allScrapedPosts.push(processedPost);
          console.info(`Processed post ${postsProcessed + 1} for influencer: ${data.influencerName}`);

          postsProcessed++;
          if (postsProcessed > 35) {
            break;
          }
          await this.randomDelay(100, 500);

          if (Math.random() > 0.8) {
            await this.randomMouseMovements(page);
            await this.randomScrolling(page);
          }

        } catch (error) {
          console.error(`Error processing post ${postsProcessed}:`, error);
          postsProcessed++;
          await this.randomDelay(100, 500);
        }
      }

      console.log(`Successfully scraped ${allScrapedPosts.length} total posts`);

      const topPosts = this.getTopUniqueInfluencerPosts(allScrapedPosts);
      const savedPosts = await this.saveNewPosts(topPosts, hashtag, existingPosts);

      const newPostsCount = savedPosts.filter(post => !existingPosts.has(post.videoUrl)).length;
      const updatedPostsCount = savedPosts.length - newPostsCount;

      console.log(`Saving results: ${newPostsCount} new posts, ${updatedPostsCount} updated posts`);

      return {
        message: `Processed ${savedPosts.length} posts for hashtag #${hashtag} (${newPostsCount} new, ${updatedPostsCount} updated)`,
        data: savedPosts,
      };
    } catch (error) {
      console.error('Error during scraping:', error);
      return {
        message: `Scraping failed: ${error.message}`,
        data: [],
      };
    } finally {
      await browser.close();
    }
  }
} 