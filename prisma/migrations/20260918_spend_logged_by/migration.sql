-- Track who actually LOGGED a spend (vs `memberId` = whom it's filed under), so the spend
-- activity feed can show "X added under Y" when a head logs for another member or a family-card
-- spend attributes to the card owner.
ALTER TABLE "Spend" ADD COLUMN "loggedById" INTEGER;
CREATE INDEX "Spend_loggedById_idx" ON "Spend"("loggedById");
ALTER TABLE "Spend"
  ADD CONSTRAINT "Spend_loggedById_fkey"
  FOREIGN KEY ("loggedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
