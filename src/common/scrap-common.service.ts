const nlp = require('compromise');
const UserAgent = require('user-agents');

import { Injectable } from '@nestjs/common';
import { Page } from "puppeteer";

@Injectable()
export class ScrapCommonService {
  protected readonly TIMEOUT = 60000;
  protected readonly MAX_SCROLL_ATTEMPTS = 10;

  protected async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  protected async randomDelay(min: number = 1000, max: number = 3000): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.delay(delay);
  }

  protected async randomMouseMovements(page: Page): Promise<void> {
    try {
      const movements = Math.floor(Math.random() * 5) + 3;

      for (let i = 0; i < movements; i++) {
        const x = Math.floor(Math.random() * (page.viewport()?.width || 1920));
        const y = Math.floor(Math.random() * (page.viewport()?.height || 1080));

        await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 21) + 20 });
        await this.randomDelay(300, 800);
      }
    } catch (error) {
      console.error('Error during random mouse movements:', error);
    }
  }

  protected async randomScrolling(page: Page): Promise<void> {
    try {
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

      if (Math.random() > 0.5) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await this.randomDelay(1000, 2000);
      }
    } catch (error) {
      console.error('Error during random scrolling:', error);
    }
  }

  protected async setupPage(page: Page): Promise<void> {
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

    page.on('request', async (request) => {
      await this.randomDelay(100, 500);
      if (request.resourceType() == 'font' || request.resourceType() == 'image') {
        request.abort();
      } else {
        request.continue();
      }
    });

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

    page.on('response', async () => {
      await this.randomDelay(100, 500);
    });
  }

  protected extractContactInfo(text: string) {
    const info = {
      emails: [] as string[],
      phones: [] as string[],
      addresses: [] as string[],
      names: [] as string[],
      locations: [] as string[],
      organizations: [] as string[],
    };

    const doc = nlp(text);

    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    const regexEmails = Array.from(new Set(text.match(emailRegex) || []));

    const emailContexts = doc.match('(email|e-mail|contact|reach|write to) (us|me|at) #Email+').out('array');
    info.emails = Array.from(new Set([...regexEmails, ...emailContexts]));

    const phonePatterns = [
      /(\+\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3}[-.\s]?\d{4,6}/g,
      /\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/g,
      /\b(ext|extension|x)[-.:]?\s*(\d{1,5})\b/gi,
      /(?:\+?\d{1,4}[\s-]?)?(?:\(?\d{1,4}\)?[\s-]?)?\d{1,4}[\s-]?\d{1,4}[\s-]?\d{1,9}/g
    ];

    const regexPhones = phonePatterns.flatMap(pattern => text.match(pattern) || []);
    const phoneContexts = doc.match('(call|phone|tel|telephone|mobile|cell) (us|me|at) [0-9]+').out('array');

    info.phones = Array.from(new Set([
      ...regexPhones,
      ...phoneContexts
    ])).map(phone => phone.replace(/[^\d+]/g, ''));

    const addressPatterns = [
      /\d{1,5}\s[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Building|Suite|Apt)\s*\d*/gi,
      /P\.?O\.?\s*Box\s+\d+/gi,
      /\b\d{5}(?:-\d{4})?\b/g
    ];

    const regexAddresses = addressPatterns.flatMap(pattern => text.match(pattern) || []);

    const addressContexts = doc
      .match('(located|address|find us|visit us) at [A-Za-z0-9]+')
      .out('array');

    const locations = doc.places().out('array');
    const cities = doc.match('#City').out('array');
    const states = doc.match('#State').out('array');
    const countries = doc.match('#Country').out('array');

    info.addresses = Array.from(new Set([
      ...regexAddresses,
      ...addressContexts,
      ...locations.map((loc: string) => loc.trim()),
      ...cities.map((city: string) => city.trim()),
      ...states.map((state: string) => state.trim()),
      ...countries.map((country: string) => country.trim())
    ]));

    info.names = Array.from(new Set([
      ...doc.people().out('array'),
      ...doc.match('#FirstName #LastName').out('array'),
      ...doc.match('(I|my|our) name is [A-Z][a-z]+').out('array')
    ]));

    info.organizations = Array.from(new Set([
      ...doc.organizations().out('array'),
      ...doc.match('#Organization').out('array')
    ]));

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

  protected async extractSocialLinks(page: Page) {
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a')).map(a => a.href)
    );

    return links.filter(link =>
      /(facebook|twitter|linkedin|instagram|tiktok|youtube|whatsapp|telegram)/i.test(link)
    );
  }
} 