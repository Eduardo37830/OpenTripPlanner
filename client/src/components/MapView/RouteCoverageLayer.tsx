import React, { useEffect, useState } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { TripQueryVariables } from '../../gql/graphql.ts';
import { request } from 'graphql-request';
import { getApiUrl } from '../../util/getApiUrl.ts';
import polyline from '@mapbox/polyline';

interface RouteCoverageLayerProps {
  tripQueryVariables: TripQueryVariables;
}

interface CoverageResponse {
  trip?: {
    tripPatterns?: Array<{
      legs: Array<{
        pointsOnLink?: {
          points: string;
        };
      }>;
    }>;
  };
}

const COVERAGE_QUERY = `
  query RouteCoverage(
    $from: Location!
    $to: Location!
    $dateTime: DateTime
    $modes: Modes
    $numTripPatterns: Int
  ) {
    trip(
      from: $from
      to: $to
      dateTime: $dateTime
      modes: $modes
      numTripPatterns: $numTripPatterns
    ) {
      tripPatterns {
        legs {
          pointsOnLink {
            points
          }
        }
      }
    }
  }
`;

export const RouteCoverageLayer: React.FC<RouteCoverageLayerProps> = ({
  tripQueryVariables
}) => {
  const [coverageGeometry, setCoverageGeometry] = useState<any>(null);

  useEffect(() => {
    const hasValidFrom = tripQueryVariables.from &&
      (tripQueryVariables.from.coordinates || tripQueryVariables.from.place);

    const hasValidTo = tripQueryVariables.to &&
      (tripQueryVariables.to.coordinates || tripQueryVariables.to.place);

    if (!hasValidFrom || !hasValidTo) {
      setCoverageGeometry(null);
      return;
    }

    const calculateRouteCoverage = async () => {
      try {
        const fromCoords = tripQueryVariables.from.coordinates;
        const toCoords = tripQueryVariables.to.coordinates;

        if (!fromCoords?.latitude || !fromCoords?.longitude ||
            !toCoords?.latitude || !toCoords?.longitude) {
          setCoverageGeometry(null);
          return;
        }

        const variables = {
          ...tripQueryVariables,
          numTripPatterns: 10,
        };

        const response: CoverageResponse = await request(getApiUrl(), COVERAGE_QUERY, variables);

        if (response?.trip?.tripPatterns && response.trip.tripPatterns.length > 0) {
          const allGeometries: string[] = [];

          response.trip.tripPatterns.forEach((pattern) => {
            pattern.legs.forEach((leg) => {
              if (leg.pointsOnLink?.points) {
                allGeometries.push(leg.pointsOnLink.points);
              }
            });
          });

          if (allGeometries.length > 0) {
            const coverageArea = createCoverageFromRoutes(allGeometries);
            setCoverageGeometry(coverageArea);
          } else {
            setCoverageGeometry(null);
          }
        } else {
          setCoverageGeometry(null);
        }
      } catch (error) {
        console.error('Error calculando cobertura de rutas:', error);
        setCoverageGeometry(null);
      }
    };

    calculateRouteCoverage().catch(error => {
      console.error('Error calculando cobertura de rutas:', error);
      setCoverageGeometry(null);
    });
  }, [tripQueryVariables.from, tripQueryVariables.to, tripQueryVariables.dateTime]);

  const createCoverageFromRoutes = (geometries: string[]): any => {
    const allCoordinates: [number, number][] = [];

    geometries.forEach(geometry => {
      try {
        const decoded = polyline.decode(geometry);
        const coordinates = decoded.map((coord: [number, number]) => [coord[1], coord[0]] as [number, number]);
        allCoordinates.push(...coordinates);
      } catch (error) {
        console.warn('Error decodificando polyline:', error);
      }
    });

    if (allCoordinates.length === 0) return null;

    const hull = convexHull(allCoordinates);
    const bufferedHull = expandPolygon(hull, 0.003);

    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [bufferedHull]
        },
        properties: {
          name: 'Cobertura de Rutas Posibles',
          description: `Zona que cubre ${geometries.length} rutas posibles`
        }
      }]
    };
  };

  const convexHull = (points: [number, number][]): [number, number][] => {
    if (points.length < 3) return points;

    const uniquePoints = points.filter((point, index, arr) =>
      arr.findIndex(p => p[0] === point[0] && p[1] === point[1]) === index
    );

    if (uniquePoints.length < 3) return uniquePoints;

    const bottom = uniquePoints.reduce((min, point) =>
      point[1] < min[1] || (point[1] === min[1] && point[0] < min[0]) ? point : min
    );

    const sorted = uniquePoints
      .filter(p => p !== bottom)
      .sort((a, b) => {
        const angleA = Math.atan2(a[1] - bottom[1], a[0] - bottom[0]);
        const angleB = Math.atan2(b[1] - bottom[1], b[0] - bottom[0]);
        return angleA - angleB;
      });

    const hull = [bottom];

    for (const point of sorted) {
      while (hull.length >= 2 &&
             cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
        hull.pop();
      }
      hull.push(point);
    }

    return hull;
  };

  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  };

  const expandPolygon = (polygon: [number, number][], buffer: number): [number, number][] => {
    if (polygon.length < 3) return polygon;

    const centroid = polygon.reduce(
      (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
      [0, 0]
    ).map(coord => coord / polygon.length) as [number, number];

    return polygon.map(point => {
      const dx = point[0] - centroid[0];
      const dy = point[1] - centroid[1];
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance === 0) return point;

      const scale = 1 + buffer / distance;
      return [
        centroid[0] + dx * scale,
        centroid[1] + dy * scale
      ] as [number, number];
    });
  };

  if (!coverageGeometry) {
    return null;
  }

  return (
    <Source id="route-coverage" type="geojson" data={coverageGeometry}>
      <Layer
        id="route-coverage-fill"
        type="fill"
        paint={{
          'fill-color': '#007cbf',
          'fill-opacity': 0.25
        }}
      />
      <Layer
        id="route-coverage-stroke"
        type="line"
        paint={{
          'line-color': '#005a87',
          'line-width': 2,
          'line-opacity': 0.7
        }}
      />
    </Source>
  );
};