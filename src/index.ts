import { Context, NarrowedContext, Telegraf } from "telegraf";
import { Update } from "typegram";
import { Chain } from "./ChainClass";
import * as fs from "fs";
import {
    InlineQueryResult,
    InlineQueryResultArticle,
    Message,
} from "telegraf/typings/core/types/typegram";
require("dotenv").config();

export let defaultMsg = `Reply to this message to continue the chain!\nA second reply will overwrite your first \n\nChains will end automatically after 1 week`;

const bot: Telegraf<Context<Update>> = new Telegraf(
    process.env.BOT_TOKEN as string
);

export const ENCODER_SEPARATOR = "__";

const ERROR_CHAIN_TITLE_TOO_LONG = `Sorry, the title of the chain must be less than 256 characters long.`;
const ERROR_CHAIN_TITLE_TOO_SHORT = `Sorry, the title of the chain must be at least 1 character long.`;

const ERROR_CHAIN_MESSAGE_TOO_LONG = `Sorry, the message of the chain must be less than 256 characters long.`;
const ERROR_CHAIN_MESSAGE_TOO_SHORT = `Sorry, the message of the chain must be at least 1 character long.`;

let inlineChainData: Chain[] = [];

let inlineCreationData: {
    [chatId: number]: 1;
} = {};

let inlineReplyData: {
    [chatId: number]: string; // `chain.id`
} = {};

bot.start(async (ctx) => {
    // User adding / updating a message
    if (ctx.startPayload.startsWith("add")) {
        const chainId = ctx.startPayload.replace("add_", "");
        const chain = inlineChainData.find((chain) => chain.id === chainId);

        if (!chain) return ctx.reply(`No chain found with id ${chainId}`);

        // prompt user to enter their chain message
        ctx.reply(`Please enter your message for the chain "${chain.title}".`);

        inlineReplyData[ctx.chat.id] = chain.id;

        return;
    }

    ctx.reply("Let's create a new chain. Please send me your chain title.");
    inlineCreationData[ctx.chat.id] = 1;
});

bot.on("text", async (ctx) => {
    // Check if user is entering a chain title for an inline chain
    if (inlineCreationData[ctx.chat.id]) {
        // check conditions
        // 1) Not empty
        // 2) Not longer than 256 characters
        const sanitizedTitle = ctx.message.text.trim();
        if (sanitizedTitle.length > 256) {
            ctx.reply(
                "Chain title must be less than 256 characters. Please try again"
            );
            return;
        }
        if (sanitizedTitle.length === 0) {
            ctx.reply("Chain title cannot be empty");
            return;
        }

        // Chain title successfully received
        // Create new chain and send it to the user
        let msgText = `<b><u> ${sanitizedTitle} </u></b>\n\n<i>No respondents yet!</i>`;
        const msg = await ctx.reply(`Please wait...`);

        const msgId = msg.message_id;

        const uniqueChainId = `${ctx.chat.id}${ENCODER_SEPARATOR}${msgId}`;
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            msgId,
            undefined,
            msgText,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                switch_inline_query: sanitizedTitle,
                                text: "Share chain",
                            },
                            {
                                text: "End chain",
                                callback_data: `end_${uniqueChainId}`,
                            },
                        ],
                    ],
                },
            }
        );

        delete inlineCreationData[ctx.chat.id];

        // save the chain

        inlineChainData.push(
            new Chain(ctx.from, sanitizedTitle, uniqueChainId)
        );
    }

    // Check if user is entering a chain message for an inline chain
    if (inlineReplyData[ctx.chat.id]) {
        // check conditions
        // 1) Not empty
        // 2) Not longer than 256 characters
        const sanitizedMsg = ctx.message.text.trim();
        if (sanitizedMsg.length > 256) {
            ctx.reply(
                "Message must be less than 256 characters! Please try again."
            );
            return;
        }
        if (sanitizedMsg.length === 0) {
            ctx.reply("Message cannot be empty! Please try again.");
            return;
        }

        // Message successfully received
        // Create new chain and send it to the user

        const chainId = inlineReplyData[ctx.chat.id];

        // find the chain
        const chain = inlineChainData.find((chain) => chain.id === chainId);

        if (!chain) return ctx.reply("Chain not found");

        // add the message to the chain
        chain.updateReplies({
            first_name: ctx.from.first_name,

            memberId: ctx.from.id,
            text: sanitizedMsg,
            username: ctx.from.username || "",
        });

        // Edit all the messages shared in chats
        const chainChatId = Number(chain.id.split(ENCODER_SEPARATOR)[0]);
        const chainMsgId = Number(chain.id.split(ENCODER_SEPARATOR)[1]);
        for (const inlineMsgId of chain.sharedInChats) {
            ctx.telegram.editMessageText(
                undefined,
                undefined,
                inlineMsgId,
                chain.generateReplyMessage(chainChatId, chainMsgId),
                {
                    parse_mode: "HTML",
                    ...generateReplyMarkup(chain.id),
                }
            );
        }

        // Edit the message in the PM
        ctx.telegram.editMessageText(
            chainChatId,
            chainMsgId,
            undefined,
            chain.generateReplyMessage(chainChatId, chainMsgId),
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                switch_inline_query: chain.title,
                                text: "Share chain",
                            },
                            {
                                text: "End chain",
                                callback_data: `end_${chain.id}`,
                            },
                        ],
                    ],
                },
            }
        );

        ctx.reply(`Your message has been received.`);

        // delete the inline data
        delete inlineReplyData[ctx.chat.id];
    }

    backupAndClearInlineChains(ctx);
});

/* Inline Queries */
bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    // Look for the chain belonging to this user with the specified search terms only if it exists

    const chains = inlineChainData.filter(
        (chain) => chain.title.includes(query) && chain.by.id === ctx.from.id // todo fix this to id based
    );

    if (chains.length === 0) {
        ctx.answerInlineQuery([], {
            switch_pm_parameter: "inline",
            switch_pm_text: "Create a new chain",
            cache_time: 0,
        });
        return;
    } else {
        const mappedChains: InlineQueryResultArticle[] = chains.map((chain) => {
            
            const chatId = Number(chain.id.split(ENCODER_SEPARATOR)[0]);
            const msgId = Number(chain.id.split(ENCODER_SEPARATOR)[1]);
            return {
                type: "article",
                id: chain.id,
                title: chain.title,
                input_message_content: {
                    message_text: chain.generateReplyMessage(chatId, msgId),
                    parse_mode: "HTML",
                },
                ...generateReplyMarkup(chain.id),
            };
        });
        ctx.answerInlineQuery(mappedChains, {
            switch_pm_parameter: "inline",
            switch_pm_text: "Create a new chain",
            cache_time: 0,
        });
    }

    return;
});

/* Listen for when the user chooses a result from the inline query to share a chain */
bot.on("chosen_inline_result", (ctx) => {
    // chain shared with a group
    // if (!ctx.chat || !ctx.chat.id) return
    console.log("Shared chain");
    console.log(ctx);

    const chainId = ctx.chosenInlineResult.result_id;
    const msgId = ctx.chosenInlineResult.inline_message_id || "";

    // find the chain
    const chain = inlineChainData.find((chain) => chain.id === chainId);

    if (!chain) return console.error("ERROR: chain not found");

    // store the msgId for future editing
    chain.addNewSharedChat(msgId);

    backupAndClearInlineChains(ctx);
});

const generateReplyMarkup = (chainId: string) => {
    const url = `https://t.me/msgchainbot?start=add_${chainId}`;
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "Add your message",
                        url,
                    },
                ],
            ],
        },
    };
};

const backupAndClearInlineChains = async (ctx: Context) => {
    // todo : clear
    fs.writeFile(
        "inlineChainData.json",
        JSON.stringify(inlineChainData),
        (e) => {
            if (e) return console.log(e);
        }
    );
};

// reload objects into memory if crash
try {
    const previousInlineData: Chain[] = JSON.parse(
        fs.readFileSync("inlineChainData.json", "utf8")
    );
    if (previousInlineData.length) {
        console.log("Reloading previous inline data");
        inlineChainData = previousInlineData.map((chain) => new Chain(chain));
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
