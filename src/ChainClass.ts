import sanitizeHtml from "sanitize-html";

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

    isAnon = false;

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
            this.isAnon = restoredData.isAnon;
            this.ended = restoredData.ended;
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

    toggleAnon() {
        this.isAnon = !this.isAnon;
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
            // Sanitize reply message.
            const sanitizeBodyOptions = {
                allowedTags: ["b", "i", "u"],
            };

            const msg = sanitizeHtml(
                this.replies[Number(memberId)].text,
                sanitizeBodyOptions
            );
            if (this.isAnon) {
                chain.push(`${msg}\n\n`);
            } else {
                chain.push(
                    `<a href='t.me/${
                        this.replies[Number(memberId)].username
                    }'><b>${i + 1}. ${
                        this.replies[Number(memberId)].first_name
                    }</b></a>\n${msg}\n\n`
                );
            }
        });

        return chain.join("");
    }

    generateReplyMessage(chatId: number, msgId: number) {
        let header = "";

        if (this.ended) {
            header += `<b><u><i>❗️❗️ Chain has ended ❗️❗️</i></u></b>\n\n`;
        }

        if (this.title.length) {
            header += `<b><u>${this.title}</u></b>\n`;
            if (this.isAnon) {
                header += `<i>This chain is anonymous, your name will not be shown to anyone. </i>\n`;
            }

            header += `\n`;
        }

        let replyMsg = "";

        if (Object.keys(this.replies).length) {
            const chain = this.generateChain();
            replyMsg += `${chain}`;

            replyMsg += `${Object.keys(this.replies).length} 👥 responded\n\n`;
        } else {
            replyMsg += `<i>No respondents yet </i>\n\n`;
        }

        let footer = `<i>#${chatId}:${msgId} | by <a href='t.me/${this.by.username}'>${this.by.first_name}</a></i>`;

        // if message > 4000 characters in length, it will exceed Telegram's limits, so we show a
        // warning message to view the rest of the chain on the website.
        if ((header + replyMsg + footer).length > 4000) {
            return `${header}The length of the replies has exceeded the maximum for Telegram.\n\nPlease view the entire chain <a href='https://t.me/${
                process.env.BOT_NAME
            }/msg?startapp=reply__-__${this.id}&startApp=reply__-__${
                this.id
            }'> here </a>\n\n${
                Object.keys(this.replies).length
            } 👥 responded\n\n${footer}`;
        }

        return header + replyMsg + footer;
    }

    addNewSharedChat(msgId: string) {
        console.log("adding a new shared chat");
        this.sharedInChats.push(msgId);
    }

    endChain() {
        this.ended = true;
    }

    serialize() {
        return {
            lastUpdated: this.lastUpdated,
            by: this.by,
            replies: this.replies,
            secondLastUpdated: this.secondLastUpdated,
            title: this.title,
            id: this.id,
            sharedInChats: this.sharedInChats,
            isPublic: this.isPublic,
            isAnon: this.isAnon,
            ended: this.ended,
        };
    }
}
