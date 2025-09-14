

import React from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { TripQueryVariables } from '../../gql/graphql.ts';
import { useRouteCoverage } from '../../hooks/useRouteCoverage.ts';

interface RouteCoverageLayerProps {
    tripQueryVariables: TripQueryVariables;
}

/**
 * Componente de React que representa un área de cobertura visual en el mapa, mostrando la región
 * cubierta por posibles rutas entre los puntos de origen y destino.
 *
 * @param props - Propiedades del componente
 * @param props.tripQueryVariables - Parámetros de consulta de viaje utilizados para calcular la cobertura de la ruta
 * @returns Elemento JSX con capas del mapa o null si no hay datos de cobertura disponibles
 */
export const RouteCoverageLayer: React.FC<RouteCoverageLayerProps> = ({
    tripQueryVariables
}) => {
    const coverageGeometry = useRouteCoverage(tripQueryVariables);

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