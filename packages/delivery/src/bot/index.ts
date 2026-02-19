import { Bot, InlineKeyboard } from "grammy";
import * as repo from "../db/repository.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// ============ Commands ============

bot.command("start", async (ctx) => {
  const chatId = ctx.chat.id;
  const username = ctx.from?.username ?? null;

  // Generate link token
  const token = await repo.createPendingLink(chatId, username);
  const linkUrl = `${env.LINK_BASE_URL}/link?token=${token}`;

  const keyboard = new InlineKeyboard().url("🔗 Connect Account", linkUrl);

  await ctx.reply(
    `👋 Welcome to *Monarch Sentinel*!

I'll send you alerts when your DeFi positions trigger conditions you've set up.

*To get started:*
1. Click the button below to connect your app account
2. Enter your Sentinel app user ID on the link page
3. Create signals on [Monarch](https://monarchlend.xyz)
4. Receive alerts here when they trigger!

_Link expires in 15 minutes_`,
    {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    },
  );

  logger.info("New user started bot", { chatId, username });
});

bot.command("status", async (ctx) => {
  const chatId = ctx.chat.id;
  const users = await repo.getUsersByChatId(chatId);

  if (users.length === 0) {
    await ctx.reply(
      "❌ No app accounts linked yet.\n\nUse /start to connect your account.",
      {
        parse_mode: "Markdown",
      },
    );
    return;
  }

  const linkList = users.map((u) => `• app: \`${u.app_user_id}\``).join("\n");

  await ctx.reply(
    `✅ *Linked Accounts:*\n\n${linkList}\n\nYou'll receive alerts for signals from linked accounts.`,
    { parse_mode: "Markdown" },
  );
});

bot.command("unlink", async (ctx) => {
  const chatId = ctx.chat.id;
  const users = await repo.getUsersByChatId(chatId);

  if (users.length === 0) {
    await ctx.reply("No accounts linked.");
    return;
  }

  // Create inline keyboard with unlink buttons
  const keyboard = new InlineKeyboard();
  for (const user of users) {
    const label = `app:${user.app_user_id}`;
    keyboard.text(`❌ ${label}`, `unlink:${user.id}`).row();
  }
  keyboard.text("Cancel", "unlink:cancel");

  await ctx.reply("Select an account to unlink:", { reply_markup: keyboard });
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `🛡️ *Monarch Sentinel Bot*

*Commands:*
/start - Connect your app account
/status - View linked accounts
/unlink - Remove a linked account
/help - Show this help

*How it works:*
1. Link your app account with /start
2. Create signals on [Monarch](https://monarchlend.xyz)
3. Receive alerts here when conditions trigger

*Need help?*
Join our [Discord](https://discord.gg/monarch) or visit [docs](https://docs.monarchlend.xyz)`,
    { parse_mode: "Markdown" },
  );
});

// ============ Callback Queries ============

bot.callbackQuery(/^unlink:(.+)$/, async (ctx) => {
  const linkIdRaw = ctx.match[1];

  if (linkIdRaw === "cancel") {
    await ctx.editMessageText("Cancelled.");
    await ctx.answerCallbackQuery();
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCallbackQuery({ text: "Error: no chat context" });
    return;
  }

  const linkId = Number.parseInt(linkIdRaw, 10);
  if (!Number.isFinite(linkId)) {
    await ctx.editMessageText("Invalid unlink target.");
    await ctx.answerCallbackQuery();
    return;
  }

  const success = await repo.unlinkUserById(linkId, chatId);

  if (success) {
    await ctx.editMessageText("✅ Account unlinked");
    logger.info("Account unlinked", { chatId, linkId });
  } else {
    await ctx.editMessageText("Failed to unlink account.");
  }

  await ctx.answerCallbackQuery();
});

// ============ Error Handler ============

bot.catch((err) => {
  logger.error("Bot error", { error: err.message });
});

// ============ Send Alert ============

export async function sendAlert(
  chatId: number,
  alert: {
    signalName: string;
    summary: string;
    address?: string;
    marketId?: string;
    chainId?: number;
    monarchUrl?: string;
  },
): Promise<boolean> {
  try {
    // Check rate limit
    const rateLimit = await repo.checkRateLimit(chatId);
    if (!rateLimit.allowed) {
      logger.warn("Rate limited", { chatId });
      return false;
    }

    const chainName = getChainName(alert.chainId);
    const addressShort = alert.address
      ? `${alert.address.slice(0, 6)}...${alert.address.slice(-4)}`
      : "N/A";

    let message = `🛡️ *Sentinel Alert*

📊 *${escapeMarkdown(alert.signalName)}*

${escapeMarkdown(alert.summary)}

`;

    if (alert.address) {
      message += `*Address:* \`${addressShort}\`\n`;
    }
    if (chainName) {
      message += `*Chain:* ${chainName}\n`;
    }

    const keyboard = alert.monarchUrl
      ? new InlineKeyboard().url("View on Monarch", alert.monarchUrl)
      : undefined;

    await bot.api.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });

    logger.info("Alert sent", { chatId, signalName: alert.signalName });
    return true;
  } catch (error) {
    logger.error("Failed to send alert", {
      chatId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

// ============ Helpers ============

function getChainName(chainId?: number): string | null {
  const chains: Record<number, string> = {
    1: "Ethereum",
    8453: "Base",
    42161: "Arbitrum",
    10: "Optimism",
    137: "Polygon",
  };
  return chainId ? (chains[chainId] ?? `Chain ${chainId}`) : null;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}
