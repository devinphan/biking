// map.js - Initialize Mapbox map with bike lanes, stations, traffic data, and flow visualization

// Import Mapbox and D3
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that libraries are loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);
console.log('D3 Loaded:', d3);

// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoiZHAxOSIsImEiOiJjbXA2YTFlcGgxYmh1MnJvNGZyaXBqNXk5In0.WpUOZVqFaqyNZPj3sOXToA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 10,
  maxZoom: 18,
});

// Add navigation controls
map.addControl(new mapboxgl.NavigationControl(), 'top-right');
map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

// Step 5.4: Create minute buckets for performance optimization
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Step 6.1: Create quantize scale for traffic flow (departure ratio)
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Helper function to convert coordinates to pixel positions
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Step 5.2: Helper function to format time
function formatTime(minutes) {
  if (minutes === -1) return '';
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Step 5.2: Helper function to get minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Step 5.4: Optimized filter by minute using pre-bucketed data
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  // Normalize both min and max minutes to valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Step 4.2 & 5.4: Compute station traffic (refactored for performance)
function computeStationTraffic(stations, timeFilter = -1) {
  // Get filtered trips efficiently using pre-bucketed data
  const filteredDepartures = filterByMinute(departuresByMinute, timeFilter);
  const filteredArrivals = filterByMinute(arrivalsByMinute, timeFilter);
  
  // Calculate departures
  const departures = d3.rollup(
    filteredDepartures,
    (v) => v.length,
    (d) => d.start_station_id
  );
  
  // Calculate arrivals
  const arrivals = d3.rollup(
    filteredArrivals,
    (v) => v.length,
    (d) => d.end_station_id
  );
  
  // Update each station with traffic data
  return stations.map((station) => {
    let id = station.short_name;
    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

// Define bike lane style
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 4,
  'line-opacity': 0.7
};

// Radius scale (will be updated dynamically)
let radiusScale = d3.scaleSqrt().domain([0, 100]).range([0, 25]);

// Wait for the map to load before adding data
map.on('load', async () => {
  console.log('Map loaded successfully!');
  
  // ========== STEP 2: Add Bike Lanes ==========
  
  // Add Boston bike lanes
  map.addSource('boston_bike_lanes', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  
  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_bike_lanes',
    paint: bikeLaneStyle
  });
  console.log('Boston bike lanes added');
  
  // Add Cambridge bike lanes
  map.addSource('cambridge_bike_lanes', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Bicycle/Bike_Facilities/geojson/Bike_Facilities.geojson'
  });
  
  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_bike_lanes',
    paint: bikeLaneStyle
  });
  console.log('Cambridge bike lanes added');
  
  // ========== STEP 3 & 4: Load Station and Traffic Data ==========
  
  // Select the SVG element inside the map
  const svg = d3.select('#map').select('svg');
  
  try {
    // Fetch station data
    const stationData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
    console.log('Loaded Station Data:', stationData);
    
    let stations = stationData.data.stations;
    console.log('Number of stations:', stations.length);
    
    // Step 4.1 & 5.3: Fetch and parse traffic data with date conversion
    console.log('Fetching traffic data (21MB file)...');
    const trips = await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv', (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    });
    console.log('Loaded trips:', trips.length);
    
    // Step 5.4: Populate minute buckets for performance optimization
    trips.forEach((trip) => {
      const startedMinutes = minutesSinceMidnight(trip.started_at);
      const endedMinutes = minutesSinceMidnight(trip.ended_at);
      departuresByMinute[startedMinutes].push(trip);
      arrivalsByMinute[endedMinutes].push(trip);
    });
    console.log('Minute buckets created for performance');
    
    // Initial station traffic calculation (no filter)
    stations = computeStationTraffic(stations);
    console.log('Stations with traffic:', stations.slice(0, 3));
    
    // Update radius scale domain based on max traffic
    const maxTraffic = d3.max(stations, (d) => d.totalTraffic);
    radiusScale.domain([0, maxTraffic]);
    console.log('Max traffic:', maxTraffic);
    
    // Step 6.1: Create circles with traffic flow colors
    const circles = svg
      .selectAll('circle')
      .data(stations, (d) => d.short_name)
      .enter()
      .append('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('fill-opacity', 0.8)
      .attr('cursor', 'pointer')
      .attr('pointer-events', 'auto')
      .style('--departure-ratio', (d) => {
        // Avoid division by zero
        const ratio = d.totalTraffic === 0 ? 0.5 : stationFlow(d.departures / d.totalTraffic);
        return ratio;
      });
    
    // Add tooltips
    circles.each(function(d) {
      d3.select(this)
        .append('title')
        .text(`${d.name || 'Station'}\n` +
              `🚲 Total: ${d.totalTraffic.toLocaleString()} trips\n` +
              `📤 Departures: ${d.departures.toLocaleString()}\n` +
              `📥 Arrivals: ${d.arrivals.toLocaleString()}\n` +
              `📊 Flow: ${d.departures / d.totalTraffic * 100 || 0}% departures`);
    });
    
    // Function to update circle positions
    function updatePositions() {
      circles
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy);
    }
    
    // Initial position update
    updatePositions();
    
    // Update positions when map moves
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);
    
    // ========== STEP 5: Time Filter Implementation ==========
    
    // Get DOM elements for time filter
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');
    
    // Step 5.3 & 5.4: Function to update scatterplot based on time filter
    function updateScatterPlot(timeFilter) {
      // Recompute station traffic based on filtered trips
      const filteredStations = computeStationTraffic(stations, timeFilter);
      
      // Step 5.4: Adjust circle size range based on whether filtering is applied
      if (timeFilter === -1) {
        radiusScale.range([0, 25]);
      } else {
        radiusScale.range([3, 50]);
      }
      
      // Update circles with new sizes and flow colors
      circles
        .data(filteredStations, (d) => d.short_name)
        .join('circle')
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('fill-opacity', 0.8)
        .style('--departure-ratio', (d) => {
          const ratio = d.totalTraffic === 0 ? 0.5 : stationFlow(d.departures / d.totalTraffic);
          return ratio;
        });
      
      // Update tooltips with new traffic numbers
      circles.each(function(d) {
        d3.select(this)
          .select('title')
          .text(`${d.name || 'Station'}\n` +
                `🚲 Total: ${d.totalTraffic.toLocaleString()} trips\n` +
                `📤 Departures: ${d.departures.toLocaleString()}\n` +
                `📥 Arrivals: ${d.arrivals.toLocaleString()}\n` +
                `📊 Flow: ${d.departures / d.totalTraffic * 100 || 0}% departures`);
      });
      
      console.log(`Updated for time filter: ${timeFilter === -1 ? 'no filter' : formatTime(timeFilter)}`);
    }
    
    // Step 5.2: Update time display when slider changes
    function updateTimeDisplay() {
      const timeFilter = Number(timeSlider.value);
      
      if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'inline';
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
      }
      
      // Update the scatterplot with the new filter
      updateScatterPlot(timeFilter);
    }
    
    // Add event listener for slider
    timeSlider.addEventListener('input', updateTimeDisplay);
    
    // Initial call to set default state
    updateTimeDisplay();
    
    console.log('Time filter initialized');
    
  } catch (error) {
    console.error('Error loading data:', error);
  }
});

// Log when map interaction happens
map.on('click', (e) => {
  console.log('Map clicked at:', e.lngLat);
});