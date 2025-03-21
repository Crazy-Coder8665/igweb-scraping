import { Controller, Get, Param } from '@nestjs/common';
import { ScrapIgService } from './scrap-ig.service';

@Controller('scrap-ig')
export class ScrapIgController {
  constructor(private readonly scrapIgService: ScrapIgService) { }

  @Get(':hashtag')
  async scrapHashtag(@Param('hashtag') hashtag: string) {
    return this.scrapIgService.scrapIG(hashtag);
  }

  @Get('test/:hashtag')
  async testScrap(@Param('hashtag') hashtag: string) {
    return this.scrapIgService.testScrap(hashtag);
  }
} 