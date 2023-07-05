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

import sanitizeHtml from "sanitize-html";
import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    setDoc,
    updateDoc,
    where,
    query,
    getDocs,
    orderBy,
} from "firebase/firestore";
import { COLLECTION_NAME, fireDb } from "./firebase";
const sanitizeOptions = {
    allowedTags: [],
    allowedAttributes: {},
};

const sanitizeBodyOptions = {
    allowedTags: ["b", "i", "u"],
};

const bot: Telegraf<Context<Update>> = new Telegraf(
    process.env.BOT_TOKEN as string
);

export const ENCODER_SEPARATOR = "__";

const BOT_NAME = process.env.BOT_NAME || "msgchainbot";
console.log("Running as " + BOT_NAME);

const OWNER_ID = process.env.OWNER_ID;

const CHAIN_TIMEOUT = 7 * 24 * 60 * 60 * 1000; // 7 days

const ERROR_CHAIN_TITLE_TOO_LONG = `Sorry, the title of the chain must be less than 256 characters long.`;
const ERROR_CHAIN_TITLE_TOO_SHORT = `Sorry, the title of the chain must be at least 1 character long.`;

const ERROR_CHAIN_NOT_FOUND = `Sorry, the chain was not found`;

const ERROR_CHAIN_MESSAGE_TOO_LONG = `Sorry, the message of the chain must be less than 256 characters long.`;
const ERROR_CHAIN_MESSAGE_TOO_SHORT = `Sorry, the message of the chain must be at least 1 character long.`;

const ERROR_NOT_REPLIED = `You haven't replied to this chain yet!`;

const ERROR_NOT_ALLOWED = `Sorry, this action is not allowed!`;

const SUCCESS_MESSAGE_RECEIVED = "Your message has been received!";

const PROMPT_NEW_CHAIN =
    "Let's create a new chain. Please send me your chain title.";

let inlineChainData: Chain[] = [];

let inlineCreationData: {
    [chatId: number]: 1;
} = {};

let inlineReplyData: {
    [chatId: number]: string; // `chain.id`
} = {};

bot.start(async (ctx) => {
    try {
        // User adding / updating a message
        if (ctx.startPayload.startsWith("add")) {
            // remove user from inlineReplyData if they are already in it
            delete inlineReplyData[ctx.chat.id];
            const chainId = ctx.startPayload.replace("add_", "");
            const chain = inlineChainData.find((chain) => chain.id === chainId);

            if (!chain) return ctx.reply(ERROR_CHAIN_NOT_FOUND);

            // prompt user to enter their chain message
            // Let user copy their previous message, if they sent it
            // check if user entered a message
            const userMessage = chain.replies[ctx.from.id]?.text;

            let message = `Please enter your message for the chain "${chain.title}".`;
            if (userMessage) message += `\nYour previous message is below:`;

            await ctx.reply(message);

            if (userMessage) await ctx.reply(userMessage);
            inlineReplyData[ctx.chat.id] = chain.id;

            return;
        }

        if (ctx.startPayload.startsWith("inline")) {
            // creating new
            delete inlineReplyData[ctx.chat.id];
            ctx.reply(PROMPT_NEW_CHAIN);
            inlineCreationData[ctx.chat.id] = 1;

            return;
        }

        // Check if the user shortcut the chain creation by adding text after /start
        const sanitizedTitle = sanitizeHtml(
            ctx.message?.text.replace("/start", ""),
            sanitizeOptions
        ).trim();
        if (sanitizedTitle.length) {
            // check if inputText is 0 < char < 256
            if (sanitizedTitle.length < 1) {
                return ctx.reply(ERROR_CHAIN_TITLE_TOO_SHORT);
            }
            if (sanitizedTitle.length > 256) {
                return ctx.reply(ERROR_CHAIN_TITLE_TOO_LONG);
            }

            // start the chain
            await createChain(ctx, sanitizedTitle);
            backupAndClearInlineChains(ctx);
            return;
        } else {
            ctx.reply(PROMPT_NEW_CHAIN);
            delete inlineReplyData[ctx.chat.id];
            inlineCreationData[ctx.chat.id] = 1;

            return;
        }
    } catch (e) {
        console.log("Error: ", e);
    }
});

/* Admin command: see # of active chains, etc */
bot.command("stats", (ctx) => {
    if (ctx.message.from.id.toString() != OWNER_ID) {
        return ctx.reply(ERROR_NOT_ALLOWED);
    }

    const activeChainNumber = inlineChainData.filter((e) => !e.ended).length;

    let msg = `${activeChainNumber} chains active.\n\n`;

    inlineChainData.forEach((chain, index) => {
        msg += `${index + 1}. ${
            chain.isAnon ? "Anonymous" : "Normal"
        } chain by @${chain.by.username}. Last updated on ${new Date(
            chain.lastUpdated
        ).toLocaleString("en-GB")}\n\n`;
    });

    ctx.reply(msg);
});

bot.on("text", async (ctx) => {
    // Check if user is entering a chain title for an inline chain
    try {
        if (inlineCreationData[ctx.chat.id]) {
            // check conditions
            // 1) Not empty
            // 2) Not longer than 256 characters
            const sanitizedTitle = sanitizeHtml(
                ctx.message.text,
                sanitizeOptions
            ).trim();
            if (sanitizedTitle.length > 256) {
                ctx.reply(ERROR_CHAIN_TITLE_TOO_LONG);
                return;
            }
            if (sanitizedTitle.length === 0) {
                ctx.reply(ERROR_CHAIN_TITLE_TOO_SHORT);
                return;
            }

            // Chain title successfully received
            // Create new chain and send it to the user
            await createChain(ctx, sanitizedTitle);
        }

        // Check if user is entering a chain message for an inline chain
        if (inlineReplyData[ctx.chat.id]) {
            // check conditions
            // 1) Not empty
            // 2) Not longer than 256 characters
            const sanitizedMsg = sanitizeHtml(
                ctx.message.text.trim(),
                sanitizeBodyOptions
            );
            if (sanitizedMsg.length > 256) {
                ctx.reply(ERROR_CHAIN_MESSAGE_TOO_LONG);
                return;
            }
            if (sanitizedMsg.length === 0) {
                ctx.reply(ERROR_CHAIN_MESSAGE_TOO_SHORT);
                return;
            }

            // Message successfully received
            // Create new chain and send it to the user

            const chainId = inlineReplyData[ctx.chat.id];

            // find the chain
            const chain = inlineChainData.find((chain) => chain.id === chainId);

            if (!chain) return ctx.reply(ERROR_CHAIN_NOT_FOUND);

            // add the message to the chain
            chain.updateReplies({
                first_name: ctx.from.first_name,

                memberId: ctx.from.id,
                text: sanitizedMsg,
                username: ctx.from.username || "",
            });

            // Edit all the messages shared in chats
            editMessages(chain, ctx);
        }

        backupAndClearInlineChains(ctx);
    } catch (e) {
        console.log("Error: ", e);
    }
});

/* Inline Queries */
bot.on("inline_query", async (ctx) => {
    try {
        const queryString = ctx.inlineQuery.query.trim();

        // todo: load data from Firebase
        const collectionRef = query(
            collection(fireDb, COLLECTION_NAME),
            // where(queryString, "in", "title"),
            where("by.id", "==", ctx.from.id),
            where("ended", "==", false),
            orderBy("lastUpdated", "desc")
        );

        const querySnapshot = await getDocs(collectionRef);

        let chains: InlineQueryResultArticle[] = [];

        chains.push({
            type: "article",
            id: `create__-__${queryString}`,
            title: `[Create new] ${queryString}`,
            input_message_content: {
                message_text: "Loading...",
            },
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "Loading...",
                            callback_data: "loading",
                        },
                    ],
                ],
            },
        });
        // filter out the chains that don't match queryString

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const chain = new Chain(data);

            const id = chain.id;
            const chatId = Number(chain.id.split(ENCODER_SEPARATOR)[0]);
            const msgId = Number(chain.id.split(ENCODER_SEPARATOR)[1]);

            if (!chain.title.includes(queryString)) return;

            chains.push({
                type: "article",
                id: chain.id,
                title: chain.title,
                input_message_content: {
                    message_text: chain.generateReplyMessage(chatId, msgId),
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                },
                ...generateSharedReplyMarkup(chain),
            });
        });

        // max: 50 results
        chains = chains.slice(0, 50);

        ctx.answerInlineQuery(chains, {
            cache_time: 0,
            is_personal: true,
        });

        return;

        // // Look for the chain belonging to this user with the specified search terms only if it exists

        // const chains = inlineChainData.filter(
        //     (chain) =>
        //         chain.title.includes(query) && chain.by.id === ctx.from.id // todo fix this to id based
        // );

        // // Return public chains IFF it's an exact match AND the creator is not the same as the requestor (because that's covered
        // // in the `chains` array)
        // const publicChains = inlineChainData.filter(
        //     (chain) =>
        //         chain.title === query &&
        //         chain.isPublic &&
        //         chain.by.id !== ctx.from.id
        // );

        // chains.push(...publicChains);

        // if (chains.length === 0) {
        //     ctx.answerInlineQuery([], {
        //         switch_pm_parameter: "inline",
        //         switch_pm_text: "Create a new chain",
        //         cache_time: 0,
        //     });
        //     return;
        // } else {
        //     const mappedChains: InlineQueryResultArticle[] = chains.map(
        //         (chain) => {
        //             const chatId = Number(chain.id.split(ENCODER_SEPARATOR)[0]);
        //             const msgId = Number(chain.id.split(ENCODER_SEPARATOR)[1]);
        //             return {
        //                 type: "article",
        //                 id: chain.id,
        //                 title: chain.title,
        //                 input_message_content: {
        //                     message_text: chain.generateReplyMessage(
        //                         chatId,
        //                         msgId
        //                     ),
        //                     parse_mode: "HTML",
        //                     disable_web_page_preview: true,
        //                 },
        //                 ...generateSharedReplyMarkup(chain.id),
        //             };
        //         }
        //     );
        //     ctx.answerInlineQuery(mappedChains, {
        //         switch_pm_parameter: "inline",
        //         switch_pm_text: "Create a new chain",
        //         cache_time: 0,
        //     });
        // }

        // return;
    } catch (e) {
        console.log("Error: ", e);
    }
});

/* Listen for when the user chooses a result from the inline query to share a chain */
// https://github.com/telegraf/telegraf/issues/465
bot.on("chosen_inline_result", async (ctx) => {
    try {
        console.log("chosen inline result");

        const encodedId = ctx.chosenInlineResult.result_id;
        const inlineMsgId = ctx.chosenInlineResult.inline_message_id || "";

        console.log({ encodedId });
        if (encodedId.startsWith("create__-__")) {
            // we are creating a new chain
            const sanitizedTitle = sanitizeHtml(
                encodedId.replace("create__-__", ""),
                sanitizeBodyOptions
            );

            // 1) send a notification message to the creator
            const loadingMsg = await ctx.telegram.sendMessage(
                ctx.from.id,
                "Loading..."
            );

            const uniqueChainId = `${ctx.from.id}${ENCODER_SEPARATOR}${loadingMsg.message_id}`;

            // 1) create template in Firebase
            const chain = new Chain(ctx.from, sanitizedTitle, uniqueChainId);

            const docRef = doc(fireDb, COLLECTION_NAME, uniqueChainId);

            inlineChainData.push(chain);

            chain.addNewSharedChat(inlineMsgId);

            editMessages(chain, ctx);

            ctx.telegram.pinChatMessage(ctx.from.id, loadingMsg.message_id);
            await setDoc(docRef, chain.serialize());
        } else {
            const chainId = ctx.chosenInlineResult.result_id;
        }

        // chain shared with a group
        // if (!ctx.chat || !ctx.chat.id) return

        // const chainId = ctx.chosenInlineResult.result_id;
        // const msgId = ctx.chosenInlineResult.inline_message_id || "";

        // // find the chain
        // const chain = inlineChainData.find((chain) => chain.id === chainId);

        // if (!chain) return console.error("ERROR: chain not found");

        // // store the msgId for future editing
        // chain.addNewSharedChat(msgId);

        // backupAndClearInlineChains(ctx);
    } catch (e) {
        console.log("Error: ", e);
    }
});

/* Listen for when user ends their chain */
bot.on("callback_query", async (ctx) => {
    try {
        const cbData = ctx.callbackQuery.data;
        if (!ctx.from) return;

        console.log(cbData);
        if (cbData?.startsWith("end")) {
            const chainId = cbData.replace("end_", "");

            // edit and end the chain
            const docRef = doc(fireDb, COLLECTION_NAME, chainId);
            updateDoc(docRef, {
                ended: true,
            });

            // const chainId = cbData.replace("end_", "");
            // // find the chain
            // const chain = inlineChainData.find((chain) => chain.id === chainId);

            // if (!chain) return ctx.answerCbQuery(ERROR_CHAIN_NOT_FOUND);

            // // end the chain
            // chain.endChain();
            // ctx.answerCbQuery("Chain ended!");
            // backupAndClearInlineChains(ctx);
        }
        if (cbData?.startsWith("remove")) {
            const chainId = cbData.replace("remove_", "");

            const docRef = doc(fireDb, COLLECTION_NAME, chainId);
            const previousData = await getDoc(docRef);
            const chain = previousData.data() as Chain;

            if (!chain) return ctx.answerCbQuery(ERROR_CHAIN_NOT_FOUND);

            const prevReplies = chain.replies;
            if (!prevReplies[ctx.from.id])
                return ctx.answerCbQuery(ERROR_NOT_REPLIED);

            // remove this user
            delete prevReplies[ctx.from.id];

            // update the chain
            updateDoc(docRef, {
                replies: prevReplies,
            });

            // find the chain
            // const chain = inlineChainData.find((chain) => chain.id === chainId);

            // if (!chain) return ctx.answerCbQuery(ERROR_CHAIN_NOT_FOUND);

            // // ignore if user never replied in the first place
            // if (!chain.replies[ctx.from.id])
            //     return ctx.answerCbQuery(ERROR_NOT_REPLIED);

            // // remove this user from the chain
            // chain.removeReply(ctx.from.id);
            // // update messages
            // editMessages(chain, ctx);
            // ctx.answerCbQuery("Message removed!");
        }

        if (cbData?.startsWith("public")) {
            const chainId = cbData.replace("public_", "");
            // find the chain
            const docRef = doc(fireDb, COLLECTION_NAME, chainId);
            const previousData = await getDoc(docRef);
            const chainData = previousData.data() as Chain;
            const chain = new Chain(chainData);
            chain.togglePublic();

            // update the chain
            updateDoc(docRef, {
                isPublic: chain.isPublic,
            });

            ctx.answerCbQuery(
                `Chain is now ${
                    chain.isPublic
                        ? "public. Other people can share your chain!"
                        : "private. Other people no longer can share your chain!"
                }`
            );
            editMessages(chain, ctx, true);
            // const chain = inlineChainData.find((chain) => chain.id === chainId);

            // if (!chain) return ctx.answerCbQuery(ERROR_CHAIN_NOT_FOUND);

            // // make the chain public
            // chain.togglePublic();
            // ctx.answerCbQuery(
            //     `Chain is now ${
            //         chain.isPublic
            //             ? "public. Other people can share your chain!"
            //             : "private. Other people no longer can share your chain!"
            //     }`
            // );

            // editMessages(chain, ctx, true);
            // edit the group messages to remove / add the 'share chain' button
        }

        // if (cbData?.startsWith("anon")) {
        //     const chainId = cbData.replace("anon_", "");
        //     // find the chain
        //     const chain = inlineChainData.find((chain) => chain.id === chainId);

        //     if (!chain) return ctx.answerCbQuery(ERROR_CHAIN_NOT_FOUND);

        //     // Note: we don't allow people to make an anonymous chain visible again.
        //     if (chain.isAnon) return ctx.answerCbQuery(ERROR_NOT_ALLOWED);

        //     // make the chain anonymous
        //     chain.toggleAnon();
        //     ctx.answerCbQuery(
        //         `Chain is now ${
        //             chain.isPublic
        //                 ? "anonymous. People won't be able to see who responded, only what they respond.!"
        //                 : "no longer anonymous. People can see the names of respondees."
        //         }`
        //     );

        //     editMessages(chain, ctx, true);
        // }
    } catch (e) {
        console.log("Error: ", e);
    }
});

const generateSharedReplyMarkup = (chain: Chain) => {
    const chainId = chain.id;
    const url = `https://t.me/${BOT_NAME}?start=add_${chainId}`;

    if (!chain) return {};

    // const inlineKeyboard: (
    //     | (
    //           | {
    //                 text: string;
    //                 url: string;
    //             }
    //           | {
    //                 text: string;
    //                 callback_data: string;
    //             }
    //       )[]
    //     | {
    //           switch_inline_query: string;
    //           text: string;
    //       }[]
    // )[] = [
    //     [
    //         {
    //             text: "Add / Edit your message",
    //             url,
    //         },
    //         {
    //             text: "Remove your message",
    //             callback_data: `remove_${chainId}`,
    //         },
    //     ],
    // ];

    const inlineKeyboard: (
        | (
              | {
                    text: string;
                    url: string;
                }
              | {
                    text: string;
                    callback_data: string;
                }
          )[]
        | {
              switch_inline_query: string;
              text: string;
          }[]
    )[] = [
        [
            {
                text: "Add / Edit your message",
                url: `https://t.me/${process.env.BOT_NAME}/msg?startapp=reply__-__${chainId}&startApp=reply__-__${chainId}`,
            },
            {
                text: "Remove your message",
                callback_data: `remove_${chainId}`,
            },
        ],
    ];

    if (chain.isPublic) {
        inlineKeyboard.push([
            {
                switch_inline_query: chain.title,
                text: "Share chain",
            },
        ]);
    }
    return {
        reply_markup: {
            inline_keyboard: inlineKeyboard,
        },
    };
};

const generatePMReplyMarkup = (chain: Chain) => {
    return {
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
                [
                    {
                        text: `Make chain ${
                            chain.isPublic ? "private" : "public"
                        }`,
                        callback_data: `public_${chain.id}`,
                    },
                ],
                // !chain.isAnon
                //     ? [
                //           {
                //               text: `Make chain ${
                //                   chain.isPublic ? "private" : "public"
                //               }`,
                //               callback_data: `public_${chain.id}`,
                //           },

                //           {
                //               text: `Hide respondents' names. This cannot be undone!`,
                //               callback_data: `anon_${chain.id}`,
                //           },
                //       ]
                //     : [
                //           {
                //               text: `Make chain ${
                //                   chain.isPublic ? "private" : "public"
                //               }`,
                //               callback_data: `public_${chain.id}`,
                //           },
                //       ],
            ],
        },
    };
};

const createChain = async (ctx: Context, sanitizedTitle: string) => {
    try {
        if (!ctx.chat) return;
        const msg = await ctx.reply(`Please wait...`);

        const msgId = msg.message_id;

        const uniqueChainId = `${ctx.chat.id}${ENCODER_SEPARATOR}${msgId}`;
        const chain = new Chain(ctx.from, sanitizedTitle, uniqueChainId);
        // save the chain
        inlineChainData.push(chain);

        ctx.telegram
            .editMessageText(
                ctx.chat.id,
                msgId,
                undefined,
                chain.generateReplyMessage(ctx.chat.id, msgId),
                {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    ...generatePMReplyMarkup(chain),
                }
            )
            .catch((e) => editErrorHandler(e, ctx));

        ctx.pinChatMessage(msgId);

        delete inlineCreationData[ctx.chat.id];
    } catch (e) {
        console.log("Error: ", e);
    }
};

const endChain = (chain: Chain, ctx?: Context) => {
    try {
        const chainChatId = Number(chain.id.split(ENCODER_SEPARATOR)[0]);
        const chainMsgId = Number(chain.id.split(ENCODER_SEPARATOR)[1]);

        // Edit group messages
        for (const inlineMsgId of chain.sharedInChats) {
            bot.telegram
                .editMessageText(
                    undefined,
                    undefined,
                    inlineMsgId,
                    chain.generateReplyMessage(chainChatId, chainMsgId),
                    {
                        parse_mode: "HTML",
                        disable_web_page_preview: true,
                    }
                )
                .catch((e) => editErrorHandler(e, ctx));
        }

        // Edit pm message
        bot.telegram
            .editMessageText(
                chainChatId,
                chainMsgId,
                undefined,
                chain.generateReplyMessage(chainChatId, chainMsgId),
                {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                }
            )
            .catch((e) => editErrorHandler(e, ctx));

        // remove the chain from the list
        // inlineChainData = inlineChainData.filter(
        //     (chain) => chain.id !== chain.id
        // );

        // backupAndClearInlineChains(ctx);
    } catch (e) {
        console.log("Error: ", e);
    }
};

const editMessages = (
    chain: Chain,
    ctx?: Context,
    preventAcknowledge = false
) => {
    try {
        // Edit all the messages shared in chats
        const chainChatId = Number(chain.id.split(ENCODER_SEPARATOR)[0]);
        const chainMsgId = Number(chain.id.split(ENCODER_SEPARATOR)[1]);
        for (const inlineMsgId of chain.sharedInChats) {
            bot.telegram
                .editMessageText(
                    undefined,
                    undefined,
                    inlineMsgId,
                    chain.generateReplyMessage(chainChatId, chainMsgId),
                    {
                        parse_mode: "HTML",
                        disable_web_page_preview: true,
                        ...generateSharedReplyMarkup(chain),
                    }
                )
                .catch((e) => editErrorHandler(e, ctx));
        }

        // Edit the message in the PM
        bot.telegram
            .editMessageText(
                chainChatId,
                chainMsgId,
                undefined,
                chain.generateReplyMessage(chainChatId, chainMsgId),
                {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    ...generatePMReplyMarkup(chain),
                }
            )
            .catch((e) => editErrorHandler(e, ctx));

        // From a user sending a message
        if (ctx && ctx.chat && !preventAcknowledge) {
            delete inlineReplyData[ctx.chat.id];
            ctx.reply(SUCCESS_MESSAGE_RECEIVED);
        }
    } catch (e) {
        console.log("Error: ", e);
    }
};

const backupAndClearInlineChains = async (ctx: Context) => {
    try {
        const stillRunningChains: Chain[] = [];

        inlineChainData.forEach((chain) => {
            if (
                chain.lastUpdated > Date.now() - CHAIN_TIMEOUT &&
                !chain.ended
            ) {
                stillRunningChains.push(chain);
            } else {
                endChain(chain, ctx);
            }
        });

        inlineChainData = stillRunningChains;
        fs.writeFile(
            "inlineChainData.json",
            JSON.stringify(inlineChainData),
            (e) => {
                if (e) return console.log(e);
            }
        );
    } catch (e) {
        console.log("Error: ", e);
    }
};

const editErrorHandler = (e: any, ctx?: Context) => {
    console.log(e);
    if (e.response.error_code === 429) {
        // too many requests, timeout and try again
        let retryTime = (e.response.parameters.retry_after + 1) * 1000;

        setTimeout(() => {
            bot.telegram.editMessageText(
                e.on.payload.chat_id,
                e.on.payload.message_id,
                e.on.payload.inline_message_id,
                e.on.payload.text,
                {
                    parse_mode: e.on.payload.parse_mode,
                    disable_web_page_preview:
                        e.on.payload.disable_web_page_preview,
                    reply_markup: e.on.payload.reply_markup,
                }
            );
        }, retryTime);
    }
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
} catch (e) {
    if (e instanceof Error) {
        if (e.message.includes("ENOENT")) {
            console.log("Backup file not found, backup not restored");
            fs.writeFile("data.json", JSON.stringify({}), (e) => {
                if (e) console.log(e);
            });
        } else {
            console.log("Error reading backup file");
            console.log(e);
        }
    }
}

bot.launch().then(() => {
    // Set up listener
    const collectionRef = collection(fireDb, COLLECTION_NAME);
    const unsubcribe = onSnapshot(collectionRef, {
        next: (snapshot) => {
            const changes = snapshot.docChanges();
            changes.forEach((change) => {
                if (change.type === "added") {
                    // shouldn't happen
                    console.log("Added: ", change.doc.data());
                } else if (change.type === "modified") {
                    console.log("Modified: ", change.doc.data());
                    const chainData = change.doc.data() as Chain;
                    const chain = new Chain(chainData);
                    if (chain.ended) {
                        console.log("ending chain", chain);
                        endChain(chain);
                    } else {
                        editMessages(chain);
                    }
                } else if (change.type === "removed") {
                    // mark chain as deleted
                    // endChain(change.doc.data() as Chain);
                }

                const chainData = change.doc.data() as Chain;
            });
        },
    });

    console.log("Bot is running!");
});

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

process.on("uncaughtException", console.log);
process.on("unhandledRejection", console.log);
process.on("warning", console.log);
process.on("error", console.log);
