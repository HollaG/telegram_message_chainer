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

export const ENCODER_SEPARATOR = "__"


export type Data = {
    [chatId: number]: {
        [messageId: number]: Chain;
    };
};
let data: Data = {};



// export type InlineChainData = {
//     [creatorId: number]: Chain[];
// };

let inlineChainData: Chain[] = [];

let inlineCreationData: {
    [chatId: number]: 1;
} = {};

let inlineReplyData: {
    [chatId: number]: string; // `chain.id`
} = {};

// Todo figure out the typescript typings for ctx and extract duplicated code into a function
bot.start(async (ctx) => {
    console.log(ctx.startPayload);
    if (ctx.startPayload === "inline") {
        ctx.reply("Let's create a new chain. Please send me your chain title.");
        inlineCreationData[ctx.chat.id] = 1;
        return;
    }

    if (ctx.startPayload.startsWith("add")) {
        const chainId = ctx.startPayload.split(ENCODER_SEPARATOR)[1];
        const chain = inlineChainData.find(
            (chain) => chain.id === chainId
        );

        if (!chain) return ctx.reply(`No chain found with id ${chainId}`);
        // prompt user to enter their chain message
        ctx.reply(`Please enter your message for the chain "${chain.title}".`);

        inlineReplyData[ctx.chat.id] = chain.id;

        return;

        // prompt user to enter their chain message
        // const chainCreatorId = Number(ctx.startPayload.split("_-_")[1]);
        // const chainTitle = ctx.startPayload.split("_-_")[2];

        // // find the chain
        // const chain = inlineChainData[chainCreatorId].find(
        //     (chain) => chain.title === chainTitle
        // );

        // if (!chain) return ctx.reply("Chain not found");

        // // prompt user to enter their chain message
        // ctx.reply(`Please enter your message for the chain "${chain.title}".`);

        // inlineReplyData[ctx.chat.id] = `${chainCreatorId}_-_${chainTitle}`;
    }

    if (ctx.chat.type === "private")
        return ctx.reply(`Sorry, this bot only works in groups!`);

    const chainInfoText = ctx.message.text.split(" ");
    chainInfoText.shift();
    const infoMsg = chainInfoText.join(" ").trim();

    const botMsg = await ctx.replyWithHTML("Please wait...");
    const botMsgId = botMsg.message_id;

    const chain = new Chain(
        { first_name: ctx.from.first_name, id: ctx.from.id },
        infoMsg,
        `${ctx.chat.id}${ENCODER_SEPARATOR}${botMsgId}`
    );

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

    const chain = new Chain(ctx.from, infoMsg, `${ctx.chat.id}${ENCODER_SEPARATOR}${botMsgId}`);

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

bot.on("text", async (ctx) => {
    if (ctx.chat.type === "private") {
        // Check if user is entering a chain title for an inline chain
        if (inlineCreationData[ctx.chat.id]) {
            // check conditions
            // 1) Not empty
            // 2) Not longer than 256 characters
            const sanitizedTitle = ctx.message.text.trim();
            if (sanitizedTitle.length > 256) {
                ctx.reply("Chain title must be less than 256 characters");
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
                                    callback_data: "end",
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

            backupAndClearInlineChains(ctx);
        }

        if (inlineReplyData[ctx.chat.id]) {
            // check conditions
            // 1) Not empty
            // 2) Not longer than 256 characters
            const sanitizedMsg = ctx.message.text.trim();
            if (sanitizedMsg.length > 256) {
                ctx.reply("Message must be less than 256 characters");
                return;
            }
            if (sanitizedMsg.length === 0) {
                ctx.reply("Message cannot be empty");
                return;
            }

            // Message successfully received
            // Create new chain and send it to the user
            
            const chainId = inlineReplyData[ctx.chat.id];

            // find the chain
            const chain = inlineChainData.find(
                (chain) => chain.id === chainId
            );

            if (!chain) return ctx.reply("Chain not found");

            // add the message to the chain
            chain.updateReplies({
                first_name: ctx.from.first_name,

                memberId: ctx.from.id,
                text: sanitizedMsg,
                username: ctx.from.username || "",
            });

            // edit the just sent message to add the ID and stuff at the bottom
            const chainChatId = Number(chain.id.split(ENCODER_SEPARATOR)[0]);
            const chainMsgId = Number(chain.id.split(ENCODER_SEPARATOR)[1]);

            ctx.telegram.editMessageText(
                chainChatId,
                chainMsgId,
                undefined,
                chain.generateReplyMessage(chainChatId, chainMsgId),
                {
                    parse_mode: "HTML",
                }
            );

            // delete the inline data
            delete inlineReplyData[ctx.chat.id];
        }
    }

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

/* Inline Queries */
bot.on("inline_query", async (ctx) => {
    console.log("Hello from inline query");
    const query = ctx.inlineQuery.query.trim();
    console.log(ctx.inlineQuery);
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
            const url = `https://t.me/msgchainbot?start=add_${chain.id}`
          
            return {
                type: "article",
                id: chain.id,
                title: chain.title,
                input_message_content: {
                    message_text: chain.title,
                    parse_mode: "HTML",
                },
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "Add your message",
                                url,
                            },
                        ],
                        [
                            {
                                text: "Activate chain",
                                callback_data: "activate",
                            },
                        ],
                    ],
                },
            };
        });
        ctx.answerInlineQuery(mappedChains, {
            switch_pm_parameter: "inline",
            switch_pm_text: "Create a new chain",
            cache_time: 0,
        });
    }

    return;
    // console.log(inlineChainData[ctx.from.id]);
    // if (inlineChainData[ctx.from.id]) {
    //     const chains = inlineChainData[ctx.from.id].filter((chain) => {
    //         // match the chain title
    //         const regex = `/.*${query}.*/i`;
    //         console.log({ regex });
    //         if (chain.title.includes(query)) return true;
    //     });

    //     console.log({ chains });
    //     if (chains.length) {
    //         const inlineAnswers: InlineQueryResultArticle[] = chains.map(
    //             (chain) => ({
    //                 type: "article",
    //                 id: "2",

    //                 thumb_url: "https://i.imgur.com/FYEGVYV.jpg",

    //                 title: chain.title,
    //                 input_message_content: {
    //                     message_text: chain.title,
    //                 },
    //                 reply_markup: {
    //                     inline_keyboard: [
    //                         [
    //                             {
    //                                 text: "Add your message",
    //                                 url: `https://t.me/msgchainbot?start=add_${chain.id}`,
    //                             },
    //                         ],
    //                         [
    //                             {
    //                                 text: "Activate chain",
    //                                 callback_data: "activate",
    //                             },
    //                         ],
    //                     ],
    //                 },
    //             })
    //         );
    //         const msg = await ctx.answerInlineQuery(
    //             inlineAnswers,

    //             {
    //                 switch_pm_parameter: "inline",
    //                 switch_pm_text: "Create a new chain",
    //                 cache_time: 0,
    //             }
    //         );
    //     } else {
    //         ctx.answerInlineQuery(
    //             [
    //                 {
    //                     type: "photo",
    //                     id: "1",
    //                     photo_url: "https://i.imgur.com/FYEGVYV.jpg",
    //                     thumb_url: "https://i.imgur.com/FYEGVYV.jpg",
    //                 },
    //             ],

    //             {
    //                 switch_pm_parameter: "inline",
    //                 switch_pm_text: "Create a new chain",
    //                 cache_time: 0,
    //             }
    //         );
    //     }
    // } else {
    //     ctx.answerInlineQuery(
    //         [
    //             {
    //                 type: "photo",
    //                 id: "1",
    //                 photo_url: "https://i.imgur.com/FYEGVYV.jpg",
    //                 thumb_url: "https://i.imgur.com/FYEGVYV.jpg",
    //             },
    //         ],

    //         {
    //             switch_pm_parameter: "inline",
    //             switch_pm_text: "Create a new chain",
    //             cache_time: 0,
    //         }
    //     );
    // }
});

// bot.on('callback_query', async (ctx) => {
//     ctx.telegram.editMessageText(ctx.chat?.id, )
// })

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
    const previousData: Data = JSON.parse(fs.readFileSync("data.json", "utf8"));
    if (Object.keys(previousData || {}).length) {
        console.log("Reloading previous data");

        for (const chatId in previousData) {
            data[chatId] = {};
            for (const messageId in previousData[chatId]) {
                const chain = new Chain(previousData[chatId][messageId]);

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
