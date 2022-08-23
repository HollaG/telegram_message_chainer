type BasicDetails = {
    id: number;
    first_name: string;
    is_bot: boolean;
    username: string;
    language_code: string;
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

    sharedInChats: string[]; // string: inlineMessageId
    id: string;

    ended = false;

    isPublic = false;

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
            this.sharedInChats = restoredData.sharedInChats;
            this.isPublic = restoredData.isPublic;
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
            this.sharedInChats = [];
        }
    }

    togglePublic() {
        this.isPublic = !this.isPublic;
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

    removeReply(memberId: number) {
        delete this.replies[memberId];

        this.secondLastUpdated = this.lastUpdated;
        this.lastUpdated = Date.now();
    }

    generateChain() {
        const chain: string[] = [];
        Object.keys(this.replies).forEach((memberId, i) => {
            chain.push(
                `<a href='t.me/${this.replies[Number(memberId)].username}'><b>${
                    i + 1
                }. ${this.replies[Number(memberId)].first_name}</b></a>\n${
                    this.replies[Number(memberId)].text
                }\n\n`
            );
        });

        return chain.join("");
    }

    generateReplyMessage(chatId: number, msgId: number) {
        let replyMsg = "";

        if (this.ended) {
            replyMsg += `<b><u><i>❗️❗️ Chain has ended ❗️❗️</i></u></b>\n\n`;
        }

        if (this.title.length) {
            replyMsg += `<b><u>${this.title}</u></b>\n\n`;
        }

        if (Object.keys(this.replies).length) {
            const chain = this.generateChain();
            replyMsg += `${chain}`;

            replyMsg += `${Object.keys(this.replies).length} 👥 responded\n\n`;
        } else {
            replyMsg += `<i>No respondents yet </i>\n\n`;
        }

        replyMsg += `<i>#${chatId}:${msgId} | by <a href='t.me/${this.by.username}'>${this.by.first_name}</a></i>`;

        return replyMsg;
    }

    addNewSharedChat(msgId: string) {
        console.log("adding a new shared chat");
        this.sharedInChats.push(msgId);
    }

    endChain() {
        this.ended = true;
    }
}
