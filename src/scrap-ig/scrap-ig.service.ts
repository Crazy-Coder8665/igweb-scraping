const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const UserAgent = require('user-agents');

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Page, ElementHandle, Browser, HTTPRequest } from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import axios from 'axios';

import { InstagramPost } from '../entities/instagram-post.entity';

// Add stealth plugin
puppeteerExtra.use(StealthPlugin());

// Custom request headers for puppeteer
const requestHeaders = {
  'authority': 'www.google.com',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'max-age=0',
  'sec-ch-ua': '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
  'sec-ch-ua-arch': '"x86"',
  'sec-ch-ua-bitness': '"64"',
  'sec-ch-ua-full-version': '"120.0.0.0"',
  'sec-ch-ua-full-version-list': '"Not/A)Brand";v="120.0.0.0", "Google Chrome";v="120.0.0.0", "Chromium";v="120.0.0.0"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-model': '""',
  'sec-ch-ua-platform': 'Windows',
  'sec-ch-ua-platform-version': '15.0.0',
  'sec-ch-ua-wow64': '?0',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Instagram credentials
const INSTAGRAM_CREDENTIALS = {
  username: 'talhanaruto262@gmail.com',
  password: 'talha_Sallu_Naruto17',
};

// Selectors for Instagram posts
const SELECTORS = {
  loginForm: 'input[name="username"]',
  posts: 'div[class*="_aagv"]',
  description: 'h1[class*="_ap3a"]',
  influencerName: 'div[class*="_a9zr"] a',
  video: 'video',
  closeButton: 'div[class*="x1i10hfl"][role="button"]',
  notificationPopup: 'button[class*="aOOlW"][class*="HoLwm"]',
  contentLoader: 'div[class*="x1iyjqo2"]',
  bioEmail: 'div[class*="_aa_c"]',
  likeCount: [
    'section[class*="x12nagc"] span',
    'div[class*="_aacl"] span',
    'div[class*="x66s6hp"] span'
  ]
};

interface PostData {
  videoUrl: string;
  description: string;
  likeCount: number;
  influencerName: string;
  email?: string;
  profileUrl?: string;
}

interface Proxy {
  ip: string;
  port: string;
  protocol: string;
}

interface GeoNodeResponse {
  data: Array<{
    ip: string;
    port: number;
    protocols: string[];
  }>;
}

interface PubProxyResponse {
  data: Array<{
    ip: string;
    port: string;
    type: string;
  }>;
}

interface ScrapRequest {
  username: string;
  password: string;
  hashtag: string;
}

@Injectable()
export class ScrapIgService {
  private readonly MAX_POSTS = 10;
  private readonly TIMEOUT = 60000;
  private readonly MAX_SCROLL_ATTEMPTS = 10; // Maximum number of times to scroll for more content
  private proxyList: Proxy[] = [];
  private currentProxyIndex = 0;

  constructor(
    @InjectRepository(InstagramPost)
    private instagramPostRepository: Repository<InstagramPost>,
  ) { }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async loginToInstagram(page: Page, credentials: { username: string; password: string }): Promise<void> {
    console.log('Navigating to Instagram login page...');
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'networkidle0',
      timeout: this.TIMEOUT,
    });

    await page.waitForSelector(SELECTORS.loginForm, { timeout: this.TIMEOUT });
    console.log('Login form found, entering credentials...');

    await page.type('input[name="username"]', credentials.username, { delay: 50 });
    await page.type('input[name="password"]', credentials.password, { delay: 50 });
    await page.click('button[type="submit"]');

    console.log('Waiting for login to complete...');
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: this.TIMEOUT });
  }

  private async handlePostLoginPopups(page: Page): Promise<void> {
    try {
      const notificationPopup = await page.$(SELECTORS.notificationPopup);
      if (notificationPopup) {
        await notificationPopup.click();
      }
    } catch (e) {
      console.log('No notification popup found');
    }
  }

  private async navigateToHashtagPage(page: Page, hashtag: string): Promise<void> {
    console.log(`Navigating to hashtag page: #${hashtag}`);
    await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
      waitUntil: 'networkidle0',
      timeout: this.TIMEOUT,
    });

    console.log('Waiting for hashtag content to load...');
    await page.waitForSelector(SELECTORS.contentLoader, { timeout: this.TIMEOUT });

    console.log('Loading more content...');
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 4);
    });
    await this.delay(2000);

    try {
      await page.waitForSelector(SELECTORS.posts, { timeout: this.TIMEOUT });
    } catch (error) {
      console.error('Error waiting for posts:', error);
      throw new Error('No Posts Found');
    }
  }

  private async getProfileEmail(page: Page, profileUrl: string): Promise<string | undefined> {
    try {
      const newPage = await page.browser().newPage();
      await newPage.setViewport({ width: 1280, height: 800 });

      await newPage.goto(profileUrl, { waitUntil: 'networkidle0', timeout: 30000 });

      const email = await newPage.evaluate(() => {
        const bioElement = document.querySelector('div[class*="_aa_c"]');
        const bio = bioElement?.textContent || '';
        const emailMatch = bio.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
        return emailMatch ? emailMatch[0] : undefined;
      });

      await newPage.close();
      return email;
    } catch (error) {
      console.error('Error getting profile email:', error);
      return undefined;
    }
  }

  private async closeModal(page: Page): Promise<void> {
    try {
      const closeButton = await page.$(SELECTORS.closeButton);
      if (closeButton) {
        await closeButton.click();
        await this.delay(1000);
      }
    } catch (error) {
      console.error('Error closing modal:', error);
    }
  }

  private async getPostElement(page: Page, index: number): Promise<ElementHandle | null> {
    const posts = await page.$$(SELECTORS.posts);
    if (index < posts.length) {
      await posts[index].evaluate(node => {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      await this.delay(500);
      return posts[index];
    }
    return null;
  }

  private async extractPostData(page: Page): Promise<PostData> {
    return await page.evaluate(() => {
      const postUrl = window.location.href;
      const element = document.querySelector('h1[class*="_ap3a"]');
      const description = element?.textContent || '';

      let likeCount = 0;
      const likeSelectors = [
        'section[class*="x12nagc"] span',
        'div[class*="_aacl"] span',
        'div[class*="x66s6hp"] span'
      ];
      for (const selector of likeSelectors) {
        const element = document.querySelector(selector);
        if (element?.textContent) {
          const text = element.textContent.replace(/[^0-9]/g, '');
          if (text) {
            likeCount = parseInt(text);
            break;
          }
        }
      }

      const influencerElement = document.querySelector('div[class*="_a9zr"] a');
      const influencerName = influencerElement?.textContent || '';
      const profileUrl = influencerElement?.getAttribute('href') || '';

      return {
        videoUrl: postUrl,
        description,
        likeCount,
        influencerName,
        profileUrl,
      };
    });
  }

  private async processPost(page: Page): Promise<InstagramPost | null> {
    const hasVideo = await page.$(SELECTORS.video);
    if (!hasVideo) {
      return null;
    }

    const postData = await this.extractPostData(page);

    if (!postData.videoUrl || !postData.videoUrl.includes('instagram.com/p/')) {
      return null;
    }

    await this.delay(1000);

    if (!postData.description || !postData.likeCount) {
      const additionalData = await this.retryDataExtraction(page);
      if (!postData.description) postData.description = additionalData.description;
      if (!postData.likeCount) postData.likeCount = additionalData.likeCount;
    }

    if (postData.profileUrl) {
      const profileFullUrl = `https://www.instagram.com${postData.profileUrl}`;
      postData.email = await this.getProfileEmail(page, profileFullUrl);
    }

    return {
      description: postData.description,
      likeCount: postData.likeCount,
      videoUrl: postData.videoUrl,
      influencerName: postData.influencerName,
      email: postData.email,
    } as InstagramPost;
  }

  private async retryDataExtraction(page: Page): Promise<{ description: string; likeCount: number }> {
    return await page.evaluate(() => {
      const description = document.querySelector('div[class*="_a9zs"], h1[class*="x1lliihq"], div[class*="x1lliihq"]')?.textContent || '';
      const likeElement = document.querySelector('section[class*="x12nagc"] span, div[class*="_aacl"] span');
      const likeText = likeElement?.textContent || '0';
      const likeCount = parseInt(likeText.replace(/[^0-9]/g, '')) || 0;

      return { description, likeCount };
    });
  }

  private async getExistingPosts(hashtag: string): Promise<Map<string, InstagramPost>> {
    const existingPosts = await this.instagramPostRepository.find({
      where: { hashtag },
      select: ['id', 'videoUrl', 'likeCount', 'influencerName']
    });

    // Create a map with videoUrl as key for faster lookup
    return new Map(existingPosts.map(post => [post.videoUrl, post]));
  }

  private async saveNewPosts(posts: InstagramPost[], hashtag: string, existingPosts: Map<string, InstagramPost>): Promise<InstagramPost[]> {
    const savedPosts: InstagramPost[] = [];
    const postsToUpdate: InstagramPost[] = [];
    const postsToCreate: InstagramPost[] = [];

    for (const post of posts) {
      const existingPost = existingPosts.get(post.videoUrl);

      if (existingPost) {
        // If existing post has lower like count, update it
        if (post.likeCount > existingPost.likeCount) {
          post.id = existingPost.id; // Preserve the ID for update
          postsToUpdate.push(post);
        }
      } else {
        // New post
        postsToCreate.push({
          ...post,
          hashtag
        });
      }
    }

    try {
      // Batch create new posts
      if (postsToCreate.length > 0) {
        const newPosts = await this.instagramPostRepository.save(postsToCreate);
        savedPosts.push(...newPosts);
      }

      // Batch update existing posts
      if (postsToUpdate.length > 0) {
        const updatedPosts = await this.instagramPostRepository.save(postsToUpdate);
        savedPosts.push(...updatedPosts);
      }

      return savedPosts;
    } catch (error) {
      console.error('Error saving posts to database:', error);
      throw new Error('Failed to save posts to database');
    }
  }

  private getTopUniqueInfluencerPosts(posts: InstagramPost[]): InstagramPost[] {
    // Create a map to store the highest-liked post for each influencer
    const influencerMap = new Map<string, InstagramPost>();

    // For each post, keep only the highest-liked post per influencer
    posts.forEach(post => {
      const existingPost = influencerMap.get(post.influencerName);
      if (!existingPost || post.likeCount > existingPost.likeCount) {
        influencerMap.set(post.influencerName, post);
      }
    });

    // Convert map values to array and sort by like count
    const uniquePosts = Array.from(influencerMap.values())
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, this.MAX_POSTS);

    return uniquePosts;
  }

  private async randomDelay(min: number = 1000, max: number = 3000): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.delay(delay);
  }

  private async randomMouseMovements(page: Page): Promise<void> {
    try {
      // Random number of mouse movements (3-7)
      const movements = Math.floor(Math.random() * 5) + 3;

      for (let i = 0; i < movements; i++) {
        // Generate random coordinates within the viewport
        const x = Math.floor(Math.random() * (page.viewport()?.width || 1920));
        const y = Math.floor(Math.random() * (page.viewport()?.height || 1080));

        // Move mouse with random steps (20-40)
        await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 21) + 20 });
        await this.randomDelay(300, 800);
      }
    } catch (error) {
      console.error('Error during random mouse movements:', error);
    }
  }

  private async randomScrolling(page: Page): Promise<void> {
    try {
      // Random number of scroll actions (2-5)
      const scrolls = Math.floor(Math.random() * 4) + 2;

      for (let i = 0; i < scrolls; i++) {
        await page.evaluate(() => {
          const scrollAmount = Math.floor(Math.random() * 400) + 100;
          const duration = Math.floor(Math.random() * 1000) + 500;
          const startTime = Date.now();

          return new Promise((resolve) => {
            function smoothScroll() {
              const currentTime = Date.now();
              const elapsed = currentTime - startTime;
              const progress = Math.min(elapsed / duration, 1);

              window.scrollBy(0, scrollAmount * progress);

              if (progress < 1) {
                requestAnimationFrame(smoothScroll);
              } else {
                resolve(true);
              }
            }
            smoothScroll();
          });
        });

        await this.randomDelay(500, 1500);
      }

      // Scroll back up randomly
      if (Math.random() > 0.5) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await this.randomDelay(1000, 2000);
      }
    } catch (error) {
      console.error('Error during random scrolling:', error);
    }
  }

  async scrapIG(data: ScrapRequest) {
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
      const existingPosts = await this.getExistingPosts(data.hashtag);
      console.log(`Found ${existingPosts.size} existing posts for hashtag #${data.hashtag}`);

      const page = await browser.newPage();

      await page.setViewport({
        width: 1920 + Math.floor(Math.random() * 100),
        height: 3000 + Math.floor(Math.random() * 100),
        deviceScaleFactor: 1,
        hasTouch: false,
        isLandscape: false,
        isMobile: false,
      });

      await page.setJavaScriptEnabled(true);
      const userAgent = new UserAgent({ deviceCategory: 'desktop' });
      await page.setUserAgent(userAgent.toString());
      await page.setRequestInterception(true);

      // Add random delays to requests
      page.on('request', async (request: HTTPRequest) => {
        await this.randomDelay(100, 500);
        if (request.resourceType() == 'font' || request.resourceType() == 'image') {
          request.abort();
        } else {
          request.continue();
        }
      });

      // Browser fingerprint evasion
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) => (
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters)
        ) as Promise<PermissionStatus>;
      });

      // Add random delays to responses
      page.on('response', async () => {
        await this.randomDelay(100, 500);
      });

      // Initial random behavior before login
      await this.randomMouseMovements(page);
      await this.randomDelay(1000, 2000);

      await this.loginToInstagram(page, { username: data.username, password: data.password });

      // Random behavior after login
      await this.randomScrolling(page);
      await this.randomMouseMovements(page);
      await this.randomDelay(1500, 3000);

      await this.handlePostLoginPopups(page);

      // Random behavior before navigating to hashtag page
      await this.randomScrolling(page);
      await this.randomDelay(1000, 2000);

      await this.navigateToHashtagPage(page, data.hashtag);

      // Random behavior after loading hashtag page
      await this.randomMouseMovements(page);
      await this.randomScrolling(page);
      await this.randomDelay(2000, 4000);

      const allScrapedPosts: InstagramPost[] = [];
      let postsProcessed = 0;
      let scrollAttempts = 0;
      let lastPostCount = 0;

      while (scrollAttempts < this.MAX_SCROLL_ATTEMPTS) {
        try {
          // Add random mouse movements occasionally
          if (Math.random() > 0.7) {
            await this.randomMouseMovements(page);
          }

          const post = await this.getPostElement(page, postsProcessed);
          if (!post) {
            if (allScrapedPosts.length === lastPostCount) {
              console.log('No new posts found after scrolling');
              break;
            }

            // More natural scrolling behavior
            await this.randomScrolling(page);
            scrollAttempts++;
            lastPostCount = allScrapedPosts.length;
            continue;
          }

          // Hover over post before clicking
          const box = await post.boundingBox();
          if (box) {
            await page.mouse.move(
              box.x + box.width / 2 + (Math.random() * 20 - 10),
              box.y + box.height / 2 + (Math.random() * 20 - 10),
              { steps: 25 }
            );
            await this.randomDelay(200, 500);
          }

          await post.click();
          await this.randomDelay(1500, 2500);

          const processedPost = await this.processPost(page);
          if (processedPost) {
            allScrapedPosts.push(processedPost);
            console.info(`Processed video posts ${allScrapedPosts.length}`);
          }

          await this.closeModal(page);
          postsProcessed++;

          // Random delay between posts
          await this.randomDelay(1000, 2000);

          // Occasionally perform random actions
          if (Math.random() > 0.8) {
            await this.randomMouseMovements(page);
            await this.randomScrolling(page);
          }

        } catch (error) {
          console.error(`Error processing post ${postsProcessed}:`, error);
          await this.closeModal(page);
          postsProcessed++;
          await this.randomDelay(1000, 2000);
        }
      }

      console.log(`Successfully scraped ${allScrapedPosts.length} video posts`);

      const topPosts = this.getTopUniqueInfluencerPosts(allScrapedPosts);
      const savedPosts = await this.saveNewPosts(topPosts, data.hashtag, existingPosts);

      const newPostsCount = savedPosts.filter(post => !existingPosts.has(post.videoUrl)).length;
      const updatedPostsCount = savedPosts.length - newPostsCount;

      return {
        message: `Processed ${savedPosts.length} posts for hashtag #${data.hashtag} (${newPostsCount} new, ${updatedPostsCount} updated)`,
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

  private async humanLikeScroll(page: Page): Promise<void> {
    await page.evaluate(() => {
      const scrollAmount = Math.floor(Math.random() * 300) + 100;
      const scrollDuration = Math.floor(Math.random() * 500) + 500;
      const startTime = Date.now();

      const smoothScroll = () => {
        const currentTime = Date.now();
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / scrollDuration, 1);

        window.scrollBy(0, scrollAmount * progress);

        if (progress < 1) {
          requestAnimationFrame(smoothScroll);
        }
      };

      smoothScroll();
    });
    await this.randomDelay(500, 1500);
  }

  private async humanLikeClick(page: Page, selector: string): Promise<void> {
    const element = await page.$(selector);
    if (element) {
      const box = await element.boundingBox();
      if (box) {
        const x = box.x + Math.random() * box.width;
        const y = box.y + Math.random() * box.height;

        await page.mouse.move(x, y, { steps: 25 });
        await this.randomDelay(100, 300);
        await page.mouse.click(x, y);
      }
    }
  }

  async testScrap(hashtag: string) {
    const browser = await puppeteerExtra.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
    });

    const page = await browser.newPage();

    // Set custom headers
    await page.setExtraHTTPHeaders(requestHeaders);

    // Enable request interception
    await page.setRequestInterception(true);

    // Add random delays to requests
    page.on('request', async (request: HTTPRequest) => {
      // Skip images and unnecessary resources to improve performance
      if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
        request.abort();
        return;
      }
      await this.randomDelay(100, 500);
      request.continue();
    });

    // Add random delays to responses
    page.on('response', async () => {
      await this.randomDelay(100, 500);
    });

    try {
      console.log('Navigating to login page...');
      await page.goto('https://quotes.toscrape.com/login', {
        waitUntil: 'networkidle0',
        timeout: this.TIMEOUT,
      });

      // Simulate human-like behavior before interacting with the login form
      await this.humanLikeScroll(page);
      await this.randomDelay(1000, 2000);

      await page.waitForSelector("div[class*='form-group']", { timeout: this.TIMEOUT });
      console.log('Login form found, entering credentials...');

      // Type credentials with random delays
      await page.type('input[name="username"]', INSTAGRAM_CREDENTIALS.username, { delay: Math.random() * 100 + 50 });
      await this.randomDelay(500, 1000);
      await page.type('input[name="password"]', INSTAGRAM_CREDENTIALS.password, { delay: Math.random() * 100 + 50 });
      await this.randomDelay(500, 1000);

      // Click submit button with human-like behavior
      await this.humanLikeClick(page, 'input[type="submit"]');

      console.log('Waiting for login to complete...');
      await page.waitForNavigation();

      // Random delay after login
      await this.randomDelay(2000, 4000);

      console.log(`Navigating to hashtag page: #${hashtag}`);
      await page.goto(`https://quotes.toscrape.com/tag/${hashtag}/`, {
        waitUntil: 'networkidle0',
        timeout: this.TIMEOUT,
      });

      // Simulate human-like scrolling before starting to scrape
      for (let i = 0; i < 3; i++) {
        await this.humanLikeScroll(page);
      }

      console.log('Waiting for hashtag content to load...');
      await page.waitForSelector("ul[class*='pager']", { timeout: this.TIMEOUT });

      const allScrapedPosts = [];
      let postsProcessed = 0;
      let scrollAttempts = 0;
      let lastPostCount = 0;

      while (scrollAttempts < this.MAX_SCROLL_ATTEMPTS) {
        try {
          let post;
          const posts = await page.$$("div[class*='quote']");
          if (postsProcessed < posts.length) {
            // Scroll to post with human-like behavior
            await posts[postsProcessed].evaluate(node => {
              node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            await this.randomDelay(800, 1500);
            post = posts[postsProcessed];
          }

          if (!post) {
            if (allScrapedPosts.length === lastPostCount) {
              console.log('No new posts found after scrolling');
              break;
            }

            // Scroll with human-like behavior
            await this.humanLikeScroll(page);
            scrollAttempts++;
            lastPostCount = allScrapedPosts.length;
            continue;
          }

          const processedPost = await post.$$eval("div[class*='quote']", () => {
            const text = document.querySelector('.text')?.textContent || '';
            const author = document.querySelector('.author')?.textContent || '';
            const authorUrl = document.querySelector('a[href*="/author/"]')?.getAttribute('href') || '';
            const tags = Array.from(document.querySelectorAll('.tag')).map((tag) => tag.textContent);

            return { text, author, authorUrl, tags };
          });

          await this.randomDelay(1000);

          if (processedPost.authorUrl) {
            const newPage = await page.browser().newPage();
            await newPage.setViewport({ width: 1280, height: 800 });

            await newPage.goto(`https://quotes.toscrape.com${processedPost.authorUrl}`, { waitUntil: 'networkidle0', timeout: 30000 });

            await newPage.waitForSelector('.author-details');

            // Extract author details
            const authorDetails = await newPage.$eval('.author-details', (element) => {
              const name = element.querySelector('.author-title')?.textContent || '';
              const bornDate = element.querySelector('.author-born-date')?.textContent || '';
              const bornLocation = element.querySelector('.author-born-location')?.textContent || '';
              const description = element.querySelector('.author-description')?.textContent || '';

              return { name, bornDate, bornLocation, description };
            });

            await newPage.close();

            (processedPost as any).authorDetails = authorDetails;
          }

          if (processedPost) {
            allScrapedPosts.push(processedPost);
            console.info(`Processed video posts ${allScrapedPosts.length}`);
          }

          postsProcessed++;
          await this.randomDelay(1000, 2000);

        } catch (error) {
          console.error(`Error processing post ${postsProcessed}:`, error);
          postsProcessed++;
          await this.randomDelay(1000, 2000);
        }
      }

      return {
        message: `Scraped quotes data`,
        data: allScrapedPosts,
      };
    } catch (error) {
      console.error('Error during scraping:', error);
      throw new Error(`Scraping failed: ${error.message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
} 