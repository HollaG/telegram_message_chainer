import { User } from "telegraf/typings/core/types/typegram";
import { Data, defaultMsg } from ".";

type BasicDetails = {
    id: number;
    first_name: string;
};

export class Chain {
    lastUpdated: number;
    secondLastUpdated: number;
    by: BasicDetails;
    title: string;
    replies: {
        [memberId: number]: {
            text: string;
            username: string;
            first_name: string;
        };
    };



    sharedInChats: string[] // string: inlineMessageId
    id: string;


    public constructor(...args: any[]) {
        if (args.length === 1) {
            // restoring old class data
            const restoredData = args[0];
            this.lastUpdated = restoredData.lastUpdated;
            this.by = restoredData.by;
            this.replies = restoredData.replies;
            this.secondLastUpdated = restoredData.secondLastUpdated;
            this.title = restoredData.title;
            this.id = restoredData.id;
            this.sharedInChats = restoredData.sharedInChats
        } else {
            const by = args[0];
            const title = args[1];
            const id = args[2];
            this.lastUpdated = Date.now();
            this.replies = {};
            this.by = by;
            this.secondLastUpdated = Date.now();
            this.title = title;
            this.id = id;
            this.sharedInChats = []
        }
    }

    updateReplies({
        memberId,
        text,
        username,
        first_name,
    }: {
        memberId: number;
        text: string;
        username: string;
        first_name: string;
    }) {
        this.replies[memberId] = {
            text,
            username,
            first_name,
        };
        this.secondLastUpdated = this.lastUpdated;
        this.lastUpdated = Date.now();
    }

    generateChain(chatId: number, msgId: number) {
        const chain = [];
        for (const memberId in this.replies) {
            chain.push(
                `<b>${this.replies[memberId].first_name}</b>\n${this.replies[memberId].text}\n\n`
            );
        }

        return chain.join("");
    }

    generateReplyMessage(chatId: number, msgId: number) {
        let replyMsg = "";
        if (this.title.length) {
            replyMsg += `<b><u>${this.title}</u></b>\n\n`;
        }

        if (Object.keys(this.replies).length) {
            const chain = this.generateChain(chatId, msgId);
            replyMsg += `${chain}`;

            replyMsg += `${Object.keys(this.replies).length} 👥 responded\n\n`;
        } else {
            replyMsg += `<i>No respondents yet </i>\n\n`;
        }

        // replyMsg += `=====================\n\n`;

        // replyMsg += `${defaultMsg}\n\n`;

        replyMsg += `<i>#${chatId}:${msgId} | by ${this.by.first_name}</i>`;

        return replyMsg;
    }

    addNewSharedChat(msgId: string) {
        console.log('adding a new shared chat')
        this.sharedInChats.push(msgId)
        console.log(this.sharedInChats);
    }
}
