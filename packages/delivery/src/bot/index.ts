import { Bot, Context, InlineKeyboard } from "grammy";
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

  const keyboard = new InlineKeyboard().url("🔗 Connect Wallet", linkUrl);

  await ctx.reply(
    `👋 Welcome to *Monarch Sentinel*!

I'll send you alerts when your DeFi positions trigger conditions you've set up.

*To get started:*
1. Click the button below to connect your wallet
2. Sign a message to prove ownership
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
      "❌ No wallets linked yet.\n\nUse /start to connect a wallet.",
      {
        parse_mode: "Markdown",
      },
    );
    return;
  }

  const walletList = users
    .map((u) => `• \`${u.wallet.slice(0, 6)}...${u.wallet.slice(-4)}\``)
    .join("\n");

  await ctx.reply(
    `✅ *Linked Wallets:*\n\n${walletList}\n\nYou'll receive alerts for signals associated with these addresses.`,
    { parse_mode: "Markdown" },
  );
});

bot.command("unlink", async (ctx) => {
  const chatId = ctx.chat.id;
  const users = await repo.getUsersByChatId(chatId);

  if (users.length === 0) {
    await ctx.reply("No wallets linked.");
    return;
  }

  // Create inline keyboard with unlink buttons
  const keyboard = new InlineKeyboard();
  for (const user of users) {
    const shortAddr = `${user.wallet.slice(0, 6)}...${user.wallet.slice(-4)}`;
    keyboard.text(`❌ ${shortAddr}`, `unlink:${user.wallet}`).row();
  }
  keyboard.text("Cancel", "unlink:cancel");

  await ctx.reply("Select a wallet to unlink:", { reply_markup: keyboard });
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `🛡️ *Monarch Sentinel Bot*

*Commands:*
/start - Connect a new wallet
/status - View linked wallets
/unlink - Remove a wallet
/help - Show this help

*How it works:*
1. Link your wallet with /start
2. Create signals on [Monarch](https://monarchlend.xyz)
3. Receive alerts here when conditions trigger

*Need help?*
Join our [Discord](https://discord.gg/monarch) or visit [docs](https://docs.monarchlend.xyz)`,
    { parse_mode: "Markdown" },
  );
});

// ============ Callback Queries ============

bot.callbackQuery(/^unlink:(.+)$/, async (ctx) => {
  const wallet = ctx.match[1];

  if (wallet === "cancel") {
    await ctx.editMessageText("Cancelled.");
    await ctx.answerCallbackQuery();
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCallbackQuery({ text: "Error: no chat context" });
    return;
  }

  const success = await repo.unlinkWallet(wallet, chatId);

  if (success) {
    const shortAddr = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    await ctx.editMessageText(`✅ Unlinked ${shortAddr}`);
    logger.info("Wallet unlinked", { chatId, wallet });
  } else {
    await ctx.editMessageText("Failed to unlink wallet.");
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
    wallet?: string;
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
    const walletShort = alert.wallet
      ? `${alert.wallet.slice(0, 6)}...${alert.wallet.slice(-4)}`
      : "N/A";

    let message = `🛡️ *Sentinel Alert*

📊 *${escapeMarkdown(alert.signalName)}*

${escapeMarkdown(alert.summary)}

`;

    if (alert.wallet) {
      message += `*Address:* \`${walletShort}\`\n`;
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
