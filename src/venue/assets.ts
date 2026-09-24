// Each Venue's surroundings model and ambience loop, from art/ (see art/README.md). Loaded when the Venue is
// first shown, so only the first Venue counts toward the first-load budget.
import beachAmbience from '../../art/audio/beach-ambience.ogg?url';
import parkAmbience from '../../art/audio/park-ambience.ogg?url';
import rooftopAmbience from '../../art/audio/rooftop-ambience.ogg?url';
import beachModel from '../../art/models/beach.glb?url';
import parkModel from '../../art/models/park.glb?url';
import rooftopModel from '../../art/models/rooftop.glb?url';
import type { VenueId } from './venues';

export const VENUE_ASSETS: Record<VenueId, { model: string; ambience: string }> = {
  park: { model: parkModel, ambience: parkAmbience },
  rooftop: { model: rooftopModel, ambience: rooftopAmbience },
  beach: { model: beachModel, ambience: beachAmbience },
};
