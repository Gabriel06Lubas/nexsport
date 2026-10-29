import { relations } from "drizzle-orm";

import { account, emailCode, follow, profile, profileSport, session, user } from "./auth";
import {
  cancellationPolicy,
  cancellationPolicyRule,
  paymentTransaction,
  paymentTransfer,
  stripeAccount,
  subscription,
} from "./billing";
import { ageGroup, club, clubMember, clubSport, coachAssignment, equipment, facility, facilitySport, sport } from "./clubs";
import { notification } from "./notifications";
import { attendance, equipmentBooking, practiceSession, sessionParticipant } from "./scheduling";
import { comment, conversation, conversationParticipant, like, message, post, postMedia } from "./social";

// Relations power Drizzle's relational queries (db.query.*) and Drizzle
// Studio's related-row view. They don't affect the database; foreign keys
// live on the tables. `relationName` disambiguates tables linked twice.

// ---- Auth & identity ----------------------------------------------------------

export const userRelations = relations(user, ({ one, many }) => ({
  accounts: many(account),
  sessions: many(session),
  emailCodes: many(emailCode),
  profile: one(profile),
  followers: many(follow, { relationName: "following" }),
  following: many(follow, { relationName: "follower" }),
  posts: many(post),
  comments: many(comment),
  likes: many(like),
  activeClub: one(club, { fields: [user.activeClubId], references: [club.id], relationName: "activeClub" }),
  ownedClubs: many(club, { relationName: "owner" }),
  memberships: many(clubMember),
  coachedSessions: many(practiceSession, { relationName: "coach" }),
  createdSessions: many(practiceSession, { relationName: "createdBy" }),
  cancelledSessions: many(practiceSession, { relationName: "cancelledBy" }),
  sessionParticipations: many(sessionParticipant, { relationName: "participant" }),
  sentSessionInvites: many(sessionParticipant, { relationName: "invitedBy" }),
  attendances: many(attendance, { relationName: "attendee" }),
  markedAttendances: many(attendance, { relationName: "markedBy" }),
  conversationMemberships: many(conversationParticipant),
  messages: many(message),
  createdConversations: many(conversation),
  subscriptions: many(subscription),
  stripeAccount: one(stripeAccount),
  payments: many(paymentTransaction, { relationName: "payer" }),
  coachPayments: many(paymentTransaction, { relationName: "paymentCoach" }),
  notifications: many(notification, { relationName: "recipient" }),
  actorNotifications: many(notification, { relationName: "actor" }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const emailCodeRelations = relations(emailCode, ({ one }) => ({
  user: one(user, { fields: [emailCode.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const profileRelations = relations(profile, ({ one, many }) => ({
  user: one(user, { fields: [profile.userId], references: [user.id] }),
  sports: many(profileSport),
}));

export const profileSportRelations = relations(profileSport, ({ one }) => ({
  profile: one(profile, { fields: [profileSport.profileId], references: [profile.id] }),
  sport: one(sport, { fields: [profileSport.sportId], references: [sport.id] }),
}));

export const followRelations = relations(follow, ({ one }) => ({
  follower: one(user, { fields: [follow.followerId], references: [user.id], relationName: "follower" }),
  following: one(user, { fields: [follow.followingId], references: [user.id], relationName: "following" }),
}));

// ---- Clubs & assets -----------------------------------------------------------

export const clubRelations = relations(club, ({ one, many }) => ({
  owner: one(user, { fields: [club.ownerId], references: [user.id], relationName: "owner" }),
  activeForUsers: many(user, { relationName: "activeClub" }),
  members: many(clubMember),
  sports: many(clubSport),
  ageGroups: many(ageGroup),
  facilities: many(facility),
  equipment: many(equipment),
  equipmentBookings: many(equipmentBooking),
  coachAssignments: many(coachAssignment),
  sessions: many(practiceSession),
  cancellationPolicies: many(cancellationPolicy),
  posts: many(post),
  conversations: many(conversation),
  subscriptions: many(subscription),
  stripeAccount: one(stripeAccount),
  payments: many(paymentTransaction),
  notifications: many(notification),
}));

export const sportRelations = relations(sport, ({ many }) => ({
  clubs: many(clubSport),
  facilities: many(facilitySport),
  ageGroups: many(ageGroup),
  sessions: many(practiceSession),
  profiles: many(profileSport),
  coachAssignments: many(coachAssignment),
}));

export const clubSportRelations = relations(clubSport, ({ one }) => ({
  club: one(club, { fields: [clubSport.clubId], references: [club.id] }),
  sport: one(sport, { fields: [clubSport.sportId], references: [sport.id] }),
}));

export const ageGroupRelations = relations(ageGroup, ({ one, many }) => ({
  club: one(club, { fields: [ageGroup.clubId], references: [club.id] }),
  sport: one(sport, { fields: [ageGroup.sportId], references: [sport.id] }),
  members: many(clubMember),
  sessions: many(practiceSession),
  coachAssignments: many(coachAssignment),
}));

export const clubMemberRelations = relations(clubMember, ({ one, many }) => ({
  club: one(club, { fields: [clubMember.clubId], references: [club.id] }),
  user: one(user, { fields: [clubMember.userId], references: [user.id] }),
  ageGroup: one(ageGroup, { fields: [clubMember.ageGroupId], references: [ageGroup.id] }),
  coachAssignments: many(coachAssignment, { relationName: "assignmentCoach" }),
  studentAssignments: many(coachAssignment, { relationName: "assignmentStudent" }),
}));

export const coachAssignmentRelations = relations(coachAssignment, ({ one }) => ({
  club: one(club, { fields: [coachAssignment.clubId], references: [club.id] }),
  coach: one(clubMember, {
    fields: [coachAssignment.coachMemberId],
    references: [clubMember.id],
    relationName: "assignmentCoach",
  }),
  student: one(clubMember, {
    fields: [coachAssignment.studentMemberId],
    references: [clubMember.id],
    relationName: "assignmentStudent",
  }),
  ageGroup: one(ageGroup, { fields: [coachAssignment.ageGroupId], references: [ageGroup.id] }),
  sport: one(sport, { fields: [coachAssignment.sportId], references: [sport.id] }),
}));

export const facilityRelations = relations(facility, ({ one, many }) => ({
  club: one(club, { fields: [facility.clubId], references: [club.id] }),
  sports: many(facilitySport),
  sessions: many(practiceSession),
}));

export const facilitySportRelations = relations(facilitySport, ({ one }) => ({
  facility: one(facility, { fields: [facilitySport.facilityId], references: [facility.id] }),
  sport: one(sport, { fields: [facilitySport.sportId], references: [sport.id] }),
}));

export const equipmentRelations = relations(equipment, ({ one, many }) => ({
  club: one(club, { fields: [equipment.clubId], references: [club.id] }),
  bookings: many(equipmentBooking),
}));

// ---- Scheduling ---------------------------------------------------------------

export const practiceSessionRelations = relations(practiceSession, ({ one, many }) => ({
  club: one(club, { fields: [practiceSession.clubId], references: [club.id] }),
  facility: one(facility, { fields: [practiceSession.facilityId], references: [facility.id] }),
  coach: one(user, { fields: [practiceSession.coachId], references: [user.id], relationName: "coach" }),
  createdBy: one(user, { fields: [practiceSession.createdById], references: [user.id], relationName: "createdBy" }),
  cancelledBy: one(user, {
    fields: [practiceSession.cancelledById],
    references: [user.id],
    relationName: "cancelledBy",
  }),
  sport: one(sport, { fields: [practiceSession.sportId], references: [sport.id] }),
  ageGroup: one(ageGroup, { fields: [practiceSession.ageGroupId], references: [ageGroup.id] }),
  cancellationPolicy: one(cancellationPolicy, {
    fields: [practiceSession.cancellationPolicyId],
    references: [cancellationPolicy.id],
  }),
  participants: many(sessionParticipant),
  attendances: many(attendance),
  equipmentBookings: many(equipmentBooking),
  payments: many(paymentTransaction),
  notifications: many(notification),
}));

export const sessionParticipantRelations = relations(sessionParticipant, ({ one, many }) => ({
  session: one(practiceSession, { fields: [sessionParticipant.sessionId], references: [practiceSession.id] }),
  user: one(user, { fields: [sessionParticipant.userId], references: [user.id], relationName: "participant" }),
  invitedBy: one(user, {
    fields: [sessionParticipant.invitedById],
    references: [user.id],
    relationName: "invitedBy",
  }),
  attendance: one(attendance),
  payments: many(paymentTransaction),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  session: one(practiceSession, { fields: [attendance.sessionId], references: [practiceSession.id] }),
  participant: one(sessionParticipant, { fields: [attendance.participantId], references: [sessionParticipant.id] }),
  user: one(user, { fields: [attendance.userId], references: [user.id], relationName: "attendee" }),
  markedBy: one(user, { fields: [attendance.markedById], references: [user.id], relationName: "markedBy" }),
}));

export const equipmentBookingRelations = relations(equipmentBooking, ({ one }) => ({
  club: one(club, { fields: [equipmentBooking.clubId], references: [club.id] }),
  equipment: one(equipment, { fields: [equipmentBooking.equipmentId], references: [equipment.id] }),
  session: one(practiceSession, { fields: [equipmentBooking.sessionId], references: [practiceSession.id] }),
}));

// ---- Social & messaging -------------------------------------------------------

export const postRelations = relations(post, ({ one, many }) => ({
  author: one(user, { fields: [post.authorId], references: [user.id] }),
  club: one(club, { fields: [post.clubId], references: [club.id] }),
  media: many(postMedia),
  comments: many(comment),
  likes: many(like),
  notifications: many(notification),
}));

export const postMediaRelations = relations(postMedia, ({ one }) => ({
  post: one(post, { fields: [postMedia.postId], references: [post.id] }),
}));

export const commentRelations = relations(comment, ({ one, many }) => ({
  post: one(post, { fields: [comment.postId], references: [post.id] }),
  author: one(user, { fields: [comment.authorId], references: [user.id] }),
  parent: one(comment, { fields: [comment.parentId], references: [comment.id], relationName: "replies" }),
  replies: many(comment, { relationName: "replies" }),
  likes: many(like),
  notifications: many(notification),
}));

export const likeRelations = relations(like, ({ one }) => ({
  user: one(user, { fields: [like.userId], references: [user.id] }),
  post: one(post, { fields: [like.postId], references: [post.id] }),
  comment: one(comment, { fields: [like.commentId], references: [comment.id] }),
}));

export const conversationRelations = relations(conversation, ({ one, many }) => ({
  club: one(club, { fields: [conversation.clubId], references: [club.id] }),
  createdBy: one(user, { fields: [conversation.createdById], references: [user.id] }),
  participants: many(conversationParticipant),
  messages: many(message),
}));

export const conversationParticipantRelations = relations(conversationParticipant, ({ one }) => ({
  conversation: one(conversation, {
    fields: [conversationParticipant.conversationId],
    references: [conversation.id],
  }),
  user: one(user, { fields: [conversationParticipant.userId], references: [user.id] }),
}));

export const messageRelations = relations(message, ({ one }) => ({
  conversation: one(conversation, { fields: [message.conversationId], references: [conversation.id] }),
  sender: one(user, { fields: [message.senderId], references: [user.id] }),
}));

// ---- Billing ------------------------------------------------------------------

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  club: one(club, { fields: [subscription.clubId], references: [club.id] }),
  user: one(user, { fields: [subscription.userId], references: [user.id] }),
}));

export const stripeAccountRelations = relations(stripeAccount, ({ one, many }) => ({
  club: one(club, { fields: [stripeAccount.clubId], references: [club.id] }),
  user: one(user, { fields: [stripeAccount.userId], references: [user.id] }),
  transfers: many(paymentTransfer),
}));

export const paymentTransactionRelations = relations(paymentTransaction, ({ one, many }) => ({
  club: one(club, { fields: [paymentTransaction.clubId], references: [club.id] }),
  session: one(practiceSession, { fields: [paymentTransaction.sessionId], references: [practiceSession.id] }),
  participant: one(sessionParticipant, {
    fields: [paymentTransaction.participantId],
    references: [sessionParticipant.id],
  }),
  payer: one(user, { fields: [paymentTransaction.payerId], references: [user.id], relationName: "payer" }),
  coach: one(user, { fields: [paymentTransaction.coachId], references: [user.id], relationName: "paymentCoach" }),
  cancellationPolicy: one(cancellationPolicy, {
    fields: [paymentTransaction.cancellationPolicyId],
    references: [cancellationPolicy.id],
  }),
  transfers: many(paymentTransfer),
}));

export const paymentTransferRelations = relations(paymentTransfer, ({ one }) => ({
  payment: one(paymentTransaction, { fields: [paymentTransfer.paymentId], references: [paymentTransaction.id] }),
  stripeAccount: one(stripeAccount, { fields: [paymentTransfer.stripeAccountId], references: [stripeAccount.id] }),
}));

export const cancellationPolicyRelations = relations(cancellationPolicy, ({ one, many }) => ({
  club: one(club, { fields: [cancellationPolicy.clubId], references: [club.id] }),
  rules: many(cancellationPolicyRule),
  sessions: many(practiceSession),
  payments: many(paymentTransaction),
}));

export const cancellationPolicyRuleRelations = relations(cancellationPolicyRule, ({ one }) => ({
  policy: one(cancellationPolicy, { fields: [cancellationPolicyRule.policyId], references: [cancellationPolicy.id] }),
}));

// ---- Notifications ------------------------------------------------------------

export const notificationRelations = relations(notification, ({ one }) => ({
  recipient: one(user, { fields: [notification.recipientId], references: [user.id], relationName: "recipient" }),
  actor: one(user, { fields: [notification.actorId], references: [user.id], relationName: "actor" }),
  club: one(club, { fields: [notification.clubId], references: [club.id] }),
  session: one(practiceSession, { fields: [notification.sessionId], references: [practiceSession.id] }),
  post: one(post, { fields: [notification.postId], references: [post.id] }),
  comment: one(comment, { fields: [notification.commentId], references: [comment.id] }),
}));
