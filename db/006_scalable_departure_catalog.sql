-- Amplia cada salida con contenido propio para que el catalogo pueda crecer
-- a nuevos origenes, alojamientos y programas sin cambiar la landing.
alter table departures add column if not exists accommodation_name text;
alter table departures add column if not exists itinerary_summary text;
alter table departures add column if not exists activities_summary text;