const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const UserAgent = require('user-agents');
const nlp = require('compromise');


import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Page } from "puppeteer";
import { InstagramPost } from '../entities/instagram-post.entity';
import { get } from 'lodash';
import puppeteerExtra from 'puppeteer-extra';
// Add stealth plugin
puppeteerExtra.use(StealthPlugin());

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
  profileUrl?: string;
  contactInfo?: ContactInfo;
}

interface ScrapRequest {
  username: string;
  password: string;
  hashtag: string;
}

export interface ContactInfo {
  [key: string]: {
    emails: string[];
    phones: string[];
    addresses: string[];
    socialMediaLinks?: string[];
    names?: string[];
    organizations?: string[];
  };
}

@Injectable()
export class ScrapIgService {
  private readonly MAX_POSTS = 10;
  private readonly TIMEOUT = 60000;
  private readonly MAX_SCROLL_ATTEMPTS = 10; // Maximum number of times to scroll for more content

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


  private async getProfileData(page: Page, profileUrl: string): Promise<ContactInfo> {
    let contactData: ContactInfo = {};

    const newPage = await page.browser().newPage();

    try {
      await newPage.setViewport({ width: 1280, height: 800 });

      await newPage.setJavaScriptEnabled(true);
      const userAgent = new UserAgent({ deviceCategory: 'desktop' });
      await newPage.setUserAgent(userAgent.toString());
      await newPage.setRequestInterception(true);

      // Add random delays to requests
      newPage.on('request', async (request) => {
        await this.randomDelay(100, 500);
        if (request.resourceType() == 'font' || request.resourceType() == 'image') {
          request.abort();
        } else {
          request.continue();
        }
      });

      // Browser fingerprint evasion
      await newPage.evaluateOnNewDocument(() => {
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
      newPage.on('response', async () => {
        await this.randomDelay(100, 500);
      });

      await newPage.goto(profileUrl, { waitUntil: 'networkidle0', timeout: this.TIMEOUT });
      await this.randomDelay(1000, 2000);

      await this.randomScrolling(newPage);
      await this.randomMouseMovements(newPage);

      // Get all links from the bio
      const bioLinks = await newPage.evaluate(() => {
        const links: { href: string; text: string }[] = [];
        const bioElement = document.querySelector('div[class*="x7a106z"]');
        if (!bioElement) return [];

        const extractedLinks = Array.from(bioElement.querySelectorAll('a'));
        for (const link of extractedLinks) {
          links.push({ href: link.getAttribute('href') || '', text: link.textContent || '' });
        }

        return links;
      });

      // Add the profile URL to the list
      bioLinks.push({ href: profileUrl, text: '' });

      // Process each link
      for (const link of bioLinks) {
        if (!link.href) continue; // Skip empty links

        try {
          await newPage.goto(link.href, { waitUntil: 'networkidle0', timeout: this.TIMEOUT });

          await this.randomScrolling(newPage);
          await this.randomMouseMovements(newPage);
          await this.randomDelay(1000, 2000);

          // Extract text content
          const pageText = await newPage.evaluate(() => document.body.innerText);

          // Extract contact info using NLP & regex
          const contactInfo = this.extractContactInfo(pageText);

          // Extract social media & contact forms
          const socialMediaLinks = await this.extractSocialLinks(newPage);

          // Use Lodash to initialize and set values safely
          contactData[link.href] = {
            emails: get(contactInfo, 'emails', []),
            phones: get(contactInfo, 'phones', []),
            addresses: get(contactInfo, 'addresses', []),
            ...(link.href === profileUrl ? {} : {
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

      await newPage.close();
      return contactData;
    } catch (error) {
      console.error('Error getting profile data:', error);
      await newPage.close();
      return contactData;
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

  private async getPostElement(page: Page, index: number): Promise<any> {
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
      const contactInfo = await this.getProfileData(page, profileFullUrl);
      postData.contactInfo = contactInfo;
    }

    return {
      description: postData.description,
      likeCount: postData.likeCount,
      videoUrl: postData.videoUrl,
      influencerName: postData.influencerName,
      ...(postData.contactInfo && Object.keys(postData.contactInfo).length > 0 && { contactInfo: postData.contactInfo }),
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

  extractContactInfo(text: string) {
    const info = {
      emails: [] as string[],
      phones: [] as string[],
      addresses: [] as string[],
      names: [] as string[],
      locations: [] as string[],
      organizations: [] as string[],
    };

    // Create NLP document
    const doc = nlp(text);

    // Email Extraction - Combine regex and NLP
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    const regexEmails = Array.from(new Set(text.match(emailRegex) || []));

    // Use NLP to find potential email contexts
    const emailContexts = doc.match('(email|e-mail|contact|reach|write to) (us|me|at) #Email+').out('array');
    info.emails = Array.from(new Set([...regexEmails, ...emailContexts]));

    // 📞 Phone Extraction - Enhanced patterns
    const phonePatterns = [
      /(\+\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3}[-.\s]?\d{4,6}/g,
      /\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/g,
      /\b(ext|extension|x)[-.:]?\s*(\d{1,5})\b/gi,
      /(?:\+?\d{1,4}[\s-]?)?(?:\(?\d{1,4}\)?[\s-]?)?\d{1,4}[\s-]?\d{1,4}[\s-]?\d{1,9}/g

    ];

    // Combine regex matches with NLP context
    const regexPhones = phonePatterns.flatMap(pattern => text.match(pattern) || []);
    const phoneContexts = doc.match('(call|phone|tel|telephone|mobile|cell) (us|me|at) [0-9]+').out('array');

    info.phones = Array.from(new Set([
      ...regexPhones,
      ...phoneContexts
    ])).map(phone => phone.replace(/[^\d+]/g, '')); // Clean phone numbers

    // Address Extraction - Enhanced with NLP
    const addressPatterns = [
      // Street addresses
      /\d{1,5}\s[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Building|Suite|Apt)\s*\d*/gi,
      // PO Boxes
      /P\.?O\.?\s*Box\s+\d+/gi,
      // Zip codes
      /\b\d{5}(?:-\d{4})?\b/g
    ];

    // Get addresses from regex patterns
    const regexAddresses = addressPatterns.flatMap(pattern => text.match(pattern) || []);

    // Use NLP to find address contexts
    const addressContexts = doc
      .match('(located|address|find us|visit us) at [A-Za-z0-9]+')
      .out('array');

    // Get locations from NLP
    const locations = doc.places().out('array');
    const cities = doc.match('#City').out('array');
    const states = doc.match('#State').out('array');
    const countries = doc.match('#Country').out('array');

    // Combine all address-related information
    info.addresses = Array.from(new Set([
      ...regexAddresses,
      ...addressContexts,
      ...locations.map((loc: string) => loc.trim()),
      ...cities.map((city: string) => city.trim()),
      ...states.map((state: string) => state.trim()),
      ...countries.map((country: string) => country.trim())
    ]));

    // Extract Names and Organizations
    info.names = Array.from(new Set([
      ...doc.people().out('array'),
      ...doc.match('#FirstName #LastName').out('array'),
      ...doc.match('(I|my|our) name is [A-Z][a-z]+').out('array')
    ]));

    info.organizations = Array.from(new Set([
      ...doc.organizations().out('array'),
      ...doc.match('#Organization').out('array')
    ]));

    // Clean and format the results
    const cleanAndFormat = (arr: string[]) => arr
      .filter(Boolean)
      .map(item => item.trim())
      .filter(item => item.length > 1);

    return {
      emails: cleanAndFormat(info.emails),
      phones: cleanAndFormat(info.phones),
      addresses: cleanAndFormat(info.addresses),
      names: cleanAndFormat(info.names),
      organizations: cleanAndFormat(info.organizations)
    };
  }

  // Extracts Social Media Links
  async extractSocialLinks(page: Page) {
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a')).map(a => a.href)
    );

    return links.filter(link =>
      /(facebook|twitter|linkedin|instagram|tiktok|youtube|whatsapp|telegram)/i.test(link)
    );
  }



  async scrapIG(data: ScrapRequest) {
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
      page.on('request', async (request) => {
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

          await post.hover();
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

  async testScrap(hashtag: string) {
    return hashtag
  }
} 