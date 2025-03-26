import { Controller, Post, Body } from '@nestjs/common';
import { ScrapTtService } from './scrap-tt.service';

@Controller('scrap-tt')
export class ScrapTtController {
  constructor(private readonly scrapTtService: ScrapTtService) { }

  @Post()
  async scrapTT(@Body() data: { hashtag: string }) {
    return this.scrapTtService.scrapTT(data.hashtag);
  }
} 