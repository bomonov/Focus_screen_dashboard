import type { ShownPlace } from './classPlaces'

interface ClassPlaceProps {
  place: ShownPlace
  /** "BIO 181 · 9:00 AM" */
  heading: string
  /** The calendar's own words, shown when the school's map doesn't know the room. */
  location: string
  pinRef: React.Ref<HTMLSpanElement>
  pulseRef: React.Ref<HTMLSpanElement>
  buttonRef: React.Ref<HTMLButtonElement>
  /** "Open in …" was clicked and the map is opening: the card can go. */
  onOpened(): void
}

/**
 * Where a class meets: a piece of the campus map with a pin on the building, its name and room,
 * and a way to the school's own map. The pill's map card and the class list's map both show it.
 */
export function ClassPlace({
  place,
  heading,
  location,
  pinRef,
  pulseRef,
  buttonRef,
  onOpened
}: ClassPlaceProps): React.JSX.Element {
  const known = place.kind === 'building'
  // A room the school's map doesn't have: ASU's own map page can still be offered.
  const unknownSchool = place.kind === 'unknown' ? place.school : null
  const officialMap = place.kind === 'unknown' && place.officialMap

  return (
    <>
      {known && (
        <div className="peek-card__map class-map__picture">
          {place.map ? (
            <>
              <img className="peek-card__image" src={place.map.image} alt="" draggable={false} />
              <span
                className="map-spot"
                style={{ left: `${place.map.pinX * 100}%`, top: `${place.map.pinY * 100}%` }}
              >
                <span ref={pulseRef} className="map-pulse" />
                <span ref={pinRef} className="map-pin" />
              </span>
            </>
          ) : (
            <p className="peek-card__missing">The map shows here once it can be loaded.</p>
          )}
        </div>
      )}
      <div className="peek-card__text">
        <p className="peek-card__heading">{heading}</p>
        <p className="peek-card__title">{known ? place.name : location}</p>
        <p className="peek-card__detail">
          {known
            ? [place.room && `Room ${place.room}`, place.campus].filter(Boolean).join(' · ')
            : unknownSchool === 'ASU'
              ? 'Not on ASU’s campus map'
              : `Not on ${unknownSchool ?? 'the school'}’s map`}
        </p>
      </div>
      {(known || officialMap) && (
        <button
          ref={buttonRef}
          type="button"
          className="peek-card__button"
          onClick={() => {
            window.focusScreen.openClassMap(known ? place.mapKey : null)
            onOpened()
          }}
        >
          {known ? `Open in ${place.mapName}` : 'Open ASU Map'}
        </button>
      )}
    </>
  )
}
