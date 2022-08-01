import { Context, NarrowedContext, Telegraf } from "telegraf";
import { Update } from "typegram";
import { Chain } from "./ChainClass";
import * as fs from "fs";
import { Message } from "telegraf/typings/core/types/typegram";
require("dotenv").config();

export let defaultMsg = `Reply to this message to continue the chain!\nA second reply will overwrite your first \n\nChains will end automatically after 1 week`;

const bot: Telegraf<Context<Update>> = new Telegraf(
    process.env.BOT_TOKEN as string
);

export type Data = {
    [chatId: number]: {
        [messageId: number]: Chain;
    };
};
let data: Data = {};

// Todo figure out the typescript typings for ctx and extract duplicated code into a function
bot.start(async (ctx) => {
    if (ctx.chat.type === "private")
        return ctx.reply(`Sorry, this bot only works in groups!`);

    const chainInfoText = ctx.message.text.split(" ");
    chainInfoText.shift();
    const infoMsg = chainInfoText.join(" ").trim();

    const botMsg = await ctx.replyWithHTML("Please wait...");
    const botMsgId = botMsg.message_id;

    const chain = new Chain(ctx.from.first_name, infoMsg);

    // edit the just sent message to add the ID and stuff at the bottom
    ctx.telegram.editMessageText(
        ctx.chat.id,
        botMsgId,
        undefined,
        chain.generateReplyMessage(ctx.chat.id, botMsgId),
        {
            parse_mode: "HTML",
        }
    );

    if (!data[ctx.chat.id]) data[ctx.chat.id] = {};
    if (!data[ctx.chat.id][botMsgId]) data[ctx.chat.id][botMsgId] = chain;

    backupAndClear(ctx);
});

bot.command("chain", async (ctx) => {
    if (ctx.chat.type === "private")
        return ctx.reply(`Sorry, this bot only works in groups!`);

    const chainInfoText = ctx.message.text.split(" ");
    chainInfoText.shift();
    const infoMsg = chainInfoText.join(" ").trim();

    const botMsg = await ctx.replyWithHTML("Please wait...");
    const botMsgId = botMsg.message_id;

    const chain = new Chain(ctx.from.first_name, infoMsg);

    // edit the just sent message to add the ID and stuff at the bottom
    ctx.telegram.editMessageText(
        ctx.chat.id,
        botMsgId,
        undefined,
        chain.generateReplyMessage(ctx.chat.id, botMsgId),
        {
            parse_mode: "HTML",
        }
    );

    if (!data[ctx.chat.id]) data[ctx.chat.id] = {};
    if (!data[ctx.chat.id][botMsgId]) data[ctx.chat.id][botMsgId] = chain;

    backupAndClear(ctx);
});

bot.on("text", (ctx) => {
    // ignore private msgs
    if (ctx.chat.type === "private") return;

    // ignore messages not a reply
    if (!ctx.message.reply_to_message) return;

    const msgRepliedToId = ctx.message.reply_to_message.message_id;

    // ignore messages that are not being tracked
    if (!data[ctx.chat.id][msgRepliedToId]) return;

    const msgText = ctx.message.text.trim();
    data[ctx.chat.id][msgRepliedToId].updateReplies({
        first_name: ctx.from.first_name,
        username: ctx.from.username || "",
        text: msgText,
        memberId: ctx.from.id,
    });

    // update the message
    ctx.telegram.editMessageText(
        ctx.chat.id,
        msgRepliedToId,
        undefined,
        data[ctx.chat.id][msgRepliedToId].generateReplyMessage(
            ctx.chat.id,
            msgRepliedToId
        ),
        { parse_mode: "HTML" }
    );

    backupAndClear(ctx);
});

// handle loading from backup file
const backupAndClear = async (ctx: Context) => {
    // Check for and clear any chains that are more than 7 days old
    const sevenDays = 1000 * 60 * 60 * 24 * 7;

    for (const chatId in data) {
        for (const messageId in data[chatId]) {
            if (
                data[chatId][messageId].secondLastUpdated + sevenDays <
                Date.now()
            ) {
                // edit the message to indicate that tracking has ended

                await ctx.telegram.editMessageText(
                    chatId,
                    Number(messageId),
                    undefined,
                    `<b><u> Chaining has ended! </u></b>\n\n${data[chatId][
                        messageId
                    ].generateChain(Number(chatId), Number(messageId))}`,
                    {
                        parse_mode: "HTML",
                    }
                );

                delete data[chatId][messageId];
            }
        }
    }
    fs.writeFile("data.json", JSON.stringify(data), (e) => {
        if (e) return console.log(e);
    });
};

// reload objects into memory if crash
try {
    const previousData: Data = JSON.parse(fs.readFileSync("data.json", "utf8"));
    if (Object.keys(previousData || {}).length) {
        console.log("Reloading previous data");

        for (const chatId in previousData) {
            data[chatId] = {};
            for (const messageId in previousData[chatId]) {
                const chain = new Chain(
                    "",
                    "",
                    previousData[chatId][messageId]
                );

                data[chatId][messageId] = chain;
            }
        }
    }
} catch (e: any) {
    if (e.code === "ENOENT") {
        console.log("Backup file not found, backup not restored");
        fs.writeFile("data.json", JSON.stringify({}), (e) => {
            if (e) console.log(e);
        });
    } else {
        console.log("Error reading backup file");
        console.log(e);
    }
}

bot.launch();
