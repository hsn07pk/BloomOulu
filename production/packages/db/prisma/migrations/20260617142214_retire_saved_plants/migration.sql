-- Retire the saved-plants (☆ bookmark) feature.
-- Removes the SavedPlant table and the now-dead Plant.saveCount denormalised
-- counter. The favourite/vote system (PlantVote + Plant.voteCount) is now the
-- single "favourite a plant" mechanism.

-- DropTable (cascades SavedPlant's own FK constraints + indexes)
DROP TABLE "SavedPlant";

-- DropColumn: the engagement counter only the saved feature ever wrote to
ALTER TABLE "Plant" DROP COLUMN "saveCount";
