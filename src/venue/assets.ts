// Each Venue's surroundings model and ambience loop, from art/ (see art/README.md).
// Rooftop and Beach borrow the Park's until their own art exists.
import parkAmbience from '../../art/audio/park-ambience.ogg?url';
import parkModel from '../../art/models/park.glb?url';
import type { VenueId } from './venues';

export const VENUE_ASSETS: Record<VenueId, { model: string; ambience: string }> = {
  park: { model: parkModel, ambience: parkAmbience },
  rooftop: { model: parkModel, ambience: parkAmbience },
  beach: { model: parkModel, ambience: parkAmbience },
};
