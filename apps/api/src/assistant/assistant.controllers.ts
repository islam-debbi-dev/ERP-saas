import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AiConfigTestResult,
  type AiProviderConfigDto,
  type AiProviderConfigInput,
  aiProviderConfigSchema,
  type AiTenantConfigResponse,
  type AssistantChatInput,
  assistantChatSchema,
  type AssistantConversationDetailDto,
  type AssistantConversationPage,
  type AssistantConversationsQuery,
  assistantConversationsQuerySchema,
  type AssistantFeedbackInput,
  assistantFeedbackSchema,
  type AssistantStatusDto,
  type AssistantStreamEvent,
  ErrorCode,
  Feature,
  Permission,
  Role,
} from '@erp/shared';
import type { Response } from 'express';
import { type CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, RequirePermission, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AiConfigService } from './ai-config.service';
import { AssistantThrottlerGuard } from './assistant-throttler.guard';
import { AssistantService } from './assistant.service';

function send(res: Response, event: AssistantStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Open to every user: it is how the web knows whether to show the button at all. */
  @Get('status')
  status(@CurrentUser() user: CurrentUserInfo): Promise<AssistantStatusDto> {
    return this.assistant.status(user);
  }

  /**
   * SSE over POST. Every refusal (limits, quota, no provider) is thrown by `prepare`,
   * before the first byte, so it is a normal JSON error. After that, only events.
   */
  @Post('chat')
  @RequireFeature(Feature.AI_ASSISTANT)
  @RequirePermission(Permission.USE_ASSISTANT)
  @UseGuards(AssistantThrottlerGuard)
  async chat(
    @Body(new ZodValidationPipe(assistantChatSchema)) body: AssistantChatInput,
    @CurrentUser() user: CurrentUserInfo,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.assistant.prepare(body, user);

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const aborted = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) aborted.abort();
    });
    try {
      for await (const event of this.assistant.run(prepared, user, aborted.signal)) {
        if (!aborted.signal.aborted) send(res, event);
      }
    } catch {
      if (!aborted.signal.aborted) send(res, { type: 'error', code: ErrorCode.AI_UNAVAILABLE });
    }
    res.end();
  }

  @Get('conversations')
  @RequireFeature(Feature.AI_ASSISTANT)
  @RequirePermission(Permission.USE_ASSISTANT)
  conversations(
    @Query(new ZodValidationPipe(assistantConversationsQuerySchema))
    query: AssistantConversationsQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<AssistantConversationPage> {
    return this.assistant.conversations(query, user);
  }

  @Get('conversations/:id')
  @RequireFeature(Feature.AI_ASSISTANT)
  @RequirePermission(Permission.USE_ASSISTANT)
  conversation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<AssistantConversationDetailDto> {
    return this.assistant.conversation(id, user);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireFeature(Feature.AI_ASSISTANT)
  @RequirePermission(Permission.USE_ASSISTANT)
  deleteConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<void> {
    return this.assistant.deleteConversation(id, user);
  }

  @Post('messages/:id/feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireFeature(Feature.AI_ASSISTANT)
  @RequirePermission(Permission.USE_ASSISTANT)
  feedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assistantFeedbackSchema)) body: AssistantFeedbackInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<void> {
    return this.assistant.feedback(id, body, user);
  }
}

/** The company's own provider: the OWNER, in single mode or when the super-admin allows it. */
@Controller('assistant/config')
@Roles(Role.OWNER)
@RequireFeature(Feature.AI_ASSISTANT)
export class AssistantConfigController {
  constructor(private readonly configs: AiConfigService) {}

  @Get()
  get(): Promise<AiTenantConfigResponse> {
    return this.configs.tenantConfig();
  }

  @Put()
  save(
    @Body(new ZodValidationPipe(aiProviderConfigSchema)) body: AiProviderConfigInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<AiProviderConfigDto> {
    return this.configs.saveTenant(body, user);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  test(
    @Body(new ZodValidationPipe(aiProviderConfigSchema)) body: AiProviderConfigInput,
  ): Promise<AiConfigTestResult> {
    return this.configs.testTenant(body);
  }
}
