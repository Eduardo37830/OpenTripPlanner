

import { useEffect, useState } from 'react';
import { request } from 'graphql-request';
import polyline from '@mapbox/polyline';
import { TripQueryVariables } from '../gql/graphql.ts';
import { getApiUrl } from '../util/getApiUrl.ts';


const NUM_TRIP_PATTERNS_TO_FETCH = 10;
const POLYGON_BUFFER_AMOUNT = 0.003;


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


type CoverageGeometry = any;

const COVERAGE_QUERY = `
  query RouteCoverage($from: Location!, $to: Location!, $dateTime: DateTime, $modes: Modes, $numTripPatterns: Int) {
    trip(from: $from, to: $to, dateTime: $dateTime, modes: $modes, numTripPatterns: $numTripPatterns) {
      tripPatterns {
        legs {
          pointsOnLink { points }
        }
      }
    }
  }
`;


const cross = (o: [number, number], a: [number, number], b: [number, number]): number => {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
};

const convexHull = (points: [number, number][]): [number, number][] => {
    if (points.length < 3) return points;
    const uniquePoints = points.filter((point, index, arr) => arr.findIndex(p => p[0] === point[0] && p[1] === point[1]) === index);
    if (uniquePoints.length < 3) return uniquePoints;

    const bottom = uniquePoints.reduce((min, point) => point[1] < min[1] || (point[1] === min[1] && point[0] < min[0]) ? point : min);
    const sorted = uniquePoints.filter(p => p !== bottom).sort((a, b) => Math.atan2(a[1] - bottom[1], a[0] - bottom[0]) - Math.atan2(b[1] - bottom[1], b[0] - bottom[0]));

    const hull = [bottom];
    for (const point of sorted) {
        while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
            hull.pop();
        }
        hull.push(point);
    }
    return hull;
};

const expandPolygon = (polygon: [number, number][], buffer: number): [number, number][] => {
    if (polygon.length < 3) return polygon;
    const centroid = polygon.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]).map(coord => coord / polygon.length) as [number, number];
    return polygon.map(point => {
        const dx = point[0] - centroid[0];
        const dy = point[1] - centroid[1];
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance === 0) return point;
        const scale = 1 + buffer / distance;
        return [centroid[0] + dx * scale, centroid[1] + dy * scale];
    });
};

const createCoverageFromRoutes = (geometries: string[]): CoverageGeometry => {
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
    const bufferedHull = expandPolygon(hull, POLYGON_BUFFER_AMOUNT);
    bufferedHull.push(bufferedHull[0]);
    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [bufferedHull] },
            properties: { name: 'Cobertura de Rutas Posibles', description: `Zona que cubre ${geometries.length} rutas posibles` }
        }]
    };
};


export const useRouteCoverage = (tripQueryVariables: TripQueryVariables): CoverageGeometry => {
    const [coverageGeometry, setCoverageGeometry] = useState<CoverageGeometry>(null);

    useEffect(() => {
        const calculateRouteCoverage = async () => {
            if (!tripQueryVariables.from?.coordinates || !tripQueryVariables.to?.coordinates) {
                setCoverageGeometry(null);
                return;
            }

            try {
                const variables = { ...tripQueryVariables, numTripPatterns: NUM_TRIP_PATTERNS_TO_FETCH };
                const response: CoverageResponse = await request(getApiUrl(), COVERAGE_QUERY, variables);

                const patterns = response?.trip?.tripPatterns;
                if (patterns && patterns.length > 0) {
                    const allGeometries = patterns.flatMap(pattern => pattern.legs.map(leg => leg.pointsOnLink?.points).filter(Boolean) as string[]);
                    setCoverageGeometry(allGeometries.length > 0 ? createCoverageFromRoutes(allGeometries) : null);
                } else {
                    setCoverageGeometry(null);
                }
            } catch (error) {
                console.error('Error calculando cobertura de rutas:', error);
                setCoverageGeometry(null);
            }
        };

        calculateRouteCoverage();
    }, [tripQueryVariables.from, tripQueryVariables.to, tripQueryVariables.dateTime]);

    return coverageGeometry;
};