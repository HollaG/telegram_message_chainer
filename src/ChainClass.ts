import { Data, defaultMsg } from ".";

export class Chain {
    lastUpdated: number;
    secondLastUpdated: number;
    by: string;
    title: string;
    replies: {
        [memberId: number]: {
            text: string;
            username: string;
            first_name: string;
        };
    };
    constructor(by: string, title: string, restoredData?: Chain) {
        if (restoredData) {
            this.lastUpdated = restoredData.lastUpdated;
            this.by = restoredData.by;
            this.replies = restoredData.replies;
            this.secondLastUpdated = restoredData.secondLastUpdated;
            this.title = restoredData.title;
        } else {
            this.lastUpdated = Date.now();
            this.replies = {};
            this.by = by;
            this.secondLastUpdated = Date.now();
            this.title = title;
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

            replyMsg += `${Object.keys(this.replies).length} 👥 responded\n`
        }

        replyMsg += `=====================\n\n`;

        replyMsg += `${defaultMsg}\n\n`;

        replyMsg += `<i>#${chatId}:${msgId}| by ${this.by}</i>`;

        return replyMsg;
    }
}
