import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core";

import { createdAt, fk, id, idx, tstz, uniq, updatedAt } from "../columns";
import { user } from "./auth";
import { club } from "./clubs";
import { conversationType, mediaType, postVisibility } from "./enums";

// =============================================================================
// SOCIAL
// =============================================================================

export const post = pgTable(
  "Post",
  {
    id: id(),
    authorId: text().notNull(),
    /** Set when posted on behalf of / inside a club. */
    clubId: text(),
    content: varchar({ length: 5000 }),
    visibility: postVisibility().notNull().default("PUBLIC"),
    likeCount: integer().notNull().default(0),
    commentCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz(),
  },
  (t) => [
    index("Post_authorId_createdAt_idx").on(t.authorId, t.createdAt.desc().nullsFirst()),
    index("Post_clubId_createdAt_idx").on(t.clubId, t.createdAt.desc().nullsFirst()),
    index("Post_createdAt_idx").on(t.createdAt.desc().nullsFirst()),
    fk("Post", [t.authorId], [user.id]).onDelete("cascade"),
    fk("Post", [t.clubId], [club.id]).onDelete("set null"),
    check("Post_counters_non_negative", sql`"likeCount" >= 0 AND "commentCount" >= 0`),
  ],
);

export const postMedia = pgTable(
  "PostMedia",
  {
    id: id(),
    postId: text().notNull(),
    type: mediaType().notNull(),
    url: text().notNull(),
    /** Storage key (S3/R2/UploadThing) for deletion. */
    storageKey: text(),
    width: integer(),
    height: integer(),
    durationS: integer(),
    position: integer().notNull().default(0),
    altText: text(),
  },
  (t) => [uniq("PostMedia", t.postId, t.position), fk("PostMedia", [t.postId], [post.id]).onDelete("cascade")],
);

export const comment = pgTable(
  "Comment",
  {
    id: id(),
    postId: text().notNull(),
    authorId: text().notNull(),
    /** Threaded replies (one level is enforced in the service layer). */
    parentId: text(),
    content: varchar({ length: 2000 }).notNull(),
    likeCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tstz(),
  },
  (t) => [
    idx("Comment", t.postId, t.createdAt),
    idx("Comment", t.parentId),
    idx("Comment", t.authorId),
    fk("Comment", [t.postId], [post.id]).onDelete("cascade"),
    fk("Comment", [t.authorId], [user.id]).onDelete("cascade"),
    fk("Comment", [t.parentId], [t.id]).onDelete("cascade"),
    check("Comment_likeCount_non_negative", sql`"likeCount" >= 0`),
    check("Comment_no_self_parent", sql`"parentId" IS NULL OR "parentId" <> "id"`),
  ],
);

/** A like on exactly one of: a post or a comment. */
export const like = pgTable(
  "Like",
  {
    id: id(),
    userId: text().notNull(),
    postId: text(),
    commentId: text(),
    createdAt: createdAt(),
  },
  (t) => [
    // NULLs are distinct in Postgres, so these behave as "one like per target".
    uniq("Like", t.userId, t.postId),
    uniq("Like", t.userId, t.commentId),
    idx("Like", t.postId),
    idx("Like", t.commentId),
    fk("Like", [t.userId], [user.id]).onDelete("cascade"),
    fk("Like", [t.postId], [post.id]).onDelete("cascade"),
    fk("Like", [t.commentId], [comment.id]).onDelete("cascade"),
    check("Like_exactly_one_target", sql`num_nonnulls("postId", "commentId") = 1`),
  ],
);

// =============================================================================
// MESSAGING (direct + group chat; coaches ↔ students ↔ teammates)
// =============================================================================

export const conversation = pgTable(
  "Conversation",
  {
    id: id(),
    type: conversationType().notNull(),
    /** Group chats may be scoped to a club (e.g. "U14 squad"). */
    clubId: text(),
    title: text(),
    /** For DIRECT chats: "<smallerUserId>:<largerUserId>", guarantees one DM per pair. */
    directKey: text(),
    createdById: text().notNull(),
    lastMessageAt: tstz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniq("Conversation", t.directKey),
    idx("Conversation", t.clubId),
    index("Conversation_lastMessageAt_idx").on(t.lastMessageAt.desc().nullsFirst()),
    fk("Conversation", [t.clubId], [club.id]).onDelete("cascade"),
    fk("Conversation", [t.createdById], [user.id]).onDelete("restrict"),
    check("Conversation_direct_has_key", sql`"type" <> 'DIRECT' OR "directKey" IS NOT NULL`),
  ],
);

export const conversationParticipant = pgTable(
  "ConversationParticipant",
  {
    conversationId: text().notNull(),
    userId: text().notNull(),
    isAdmin: boolean().notNull().default(false),
    joinedAt: tstz().notNull().defaultNow(),
    lastReadAt: tstz(),
    mutedUntil: tstz(),
    leftAt: tstz(),
  },
  (t) => [
    primaryKey({ name: "ConversationParticipant_pkey", columns: [t.conversationId, t.userId] }),
    idx("ConversationParticipant", t.userId),
    fk("ConversationParticipant", [t.conversationId], [conversation.id]).onDelete("cascade"),
    fk("ConversationParticipant", [t.userId], [user.id]).onDelete("cascade"),
  ],
);

export const message = pgTable(
  "Message",
  {
    id: id(),
    conversationId: text().notNull(),
    senderId: text().notNull(),
    content: varchar({ length: 4000 }).notNull(),
    attachmentUrl: text(),
    createdAt: createdAt(),
    editedAt: tstz(),
    deletedAt: tstz(),
  },
  (t) => [
    index("Message_conversationId_createdAt_idx").on(t.conversationId, t.createdAt.desc().nullsFirst()),
    fk("Message", [t.conversationId], [conversation.id]).onDelete("cascade"),
    fk("Message", [t.senderId], [user.id]).onDelete("cascade"),
  ],
);
