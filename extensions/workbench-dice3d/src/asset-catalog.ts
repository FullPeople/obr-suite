import source from '../public/assets/catalog.json';
import type {Catalog} from './types';
import {materialCatalog} from './material-styles';

// Give each runtime its own catalog, without another startup network request.
export const diceCatalog=():Catalog=>materialCatalog(structuredClone(source) as unknown as Catalog);
