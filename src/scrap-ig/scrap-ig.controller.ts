import { Controller, Get, Post, Param, Body, Headers, Options } from '@nestjs/common';
import { ScrapIgService } from './scrap-ig.service';

interface ScrapRequest {
  username: string;
  password: string;
  hashtag: string;
}

@Controller('scrap-ig')
export class ScrapIgController {
  constructor(private readonly scrapIgService: ScrapIgService) { }

  @Options()
  async corsOptions() {
    return;
  }

  @Post()
  async scrapHashtag(@Body() body: ScrapRequest, @Headers() headers: any) {
    return this.scrapIgService.scrapIG(body);
  }

  @Get('test/:hashtag')
  async testScrap(@Param('hashtag') hashtag: string) {
    return this.scrapIgService.testScrap(hashtag);
  }
} 