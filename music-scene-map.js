// Copyright 2013 Peter Oliver.

// This file is part of similar-artist-locations

// similar-artist-locations is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either
// version 3 of the License, or (at your option) any later version.

// similar-artist-locations is distributed in the hope that it will be
// useful, but WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
// See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with similar-artist-locations.  If not, see
// <https://www.gnu.org/licenses/>.

function resize () {
    var content_height = $(window).height() - $('header').outerHeight(true)
        - $('.controls').outerHeight(true) - 25;

    $("div#map").height(content_height);
    $("div#sidebar").css({
        'max-height': content_height
    });
};

$(window).on("resize", resize);

$(document).ready( function () {
    resize();

    L.mapbox.accessToken = 'pk.eyJ1IjoibWF2aXQiLCJhIjoiY2piZ3J2ZTNnMmh6bzJwbXhtbzQxd3J6bSJ9.wB3unD3-Nzucj4awpQEtqg';
    var map = L.mapbox.map('map', 'mavit.h2hp2k2k').setView([25, 0], 2);
    var mb_api_url = 'https://musicbrainz.org/ws/2/';

    var cache = new LastFMCache();
    var lastfm = new LastFM({
        apiKey    : 'f21088bf9097b49ad4e7f487abab981e',
        apiSecret : '7ccaec2093e33cded282ec7bc81c6fca',
        cache     : cache
    });

    var markers = [];
    var popups = {};
    var mbid;
    var mb_request_times = [];

    $('form#artist-lookup').on("submit", lookup_artist);
    $('form#artist-search').on("submit", search_artists);
    $('form#artist-picker').on("submit", pick_artist);

    if ( mbid = new URL(window.location.href).searchParams.get('mbid') ) {
        fetch_artist_info(mbid);
    }

    function search_artists (event) {
        event.preventDefault();
        $('form#artist-picker').slideUp();
        $.ajax({
            url: mb_api_url + 'artist/?query='
                + encodeURIComponent($('input#name').val()),
            dataType: 'xml',
            success: handle_mb_search_response
        });
    }

    function pick_artist (event) {
        event.preventDefault();
        $('form#artist-picker').slideUp();
        $('table#artists > tbody').fadeOut();

        if ( Modernizr.history ) {
            history.pushState({}, '', '?mbid=' + encodeURIComponent(mbid));
        }

        fetch_artist_info(mbid);
    }

    function handle_mb_search_response (mb_data) {
        $('table#search-results > tbody').empty();
        $(mb_data).find('artist-list > artist').each( function (i) {
            $('table#search-results > tbody').append(
                $('<tr/>').append(
                    $('<td/>').append(
                        $('<button/>').attr({
                            value: $(this).attr('id')
                        }).text(
                            $(this).children('name').text()
                        )
                    ),
                    $('<td/>').append(
                        $(this).find('disambiguation').text()
                    ),
                    $('<td/>').append(
                        $('<a/>').attr({
                            href: 'https://musicbrainz.org/area/'
                                + encodeURIComponent(
                                    $(this).find('artist > area').attr('id')
                                )
                        }).text(
                            $(this).find('artist > area > name').text()
                        )
                    )
                )
            );
        });
        $('form#artist-picker button').on(
            "click",
            function () {
                mbid = this.value;
                $('input#name').val($(this).text());
            }
        );
        $('form#artist-picker').slideDown();
    }

    function lookup_artist (event) {
        event.preventDefault();
        $('form#artist-lookup input[type=submit]').attr('disabled', 'disabled');
        fetch_artist_info($('input#mbid').val());
    }

    function fetch_artist_info (mbid) {

        // Clean up any previous runs:
        markers.forEach( function (m) {
            map.removeLayer(m);
        });
        markers = [];
        popups = {};

        $('table#artists > tbody').empty();
        $('table#artists > caption').empty();

        $('img.spinner').slideDown();
        $('table#artists > tbody').fadeIn();
        $('div#sidebar').show('400');

        submit_mb_artist_request({
            mbid: mbid
        });

        lastfm.artist.getSimilar(
            {
                mbid: mbid
            },
            {
                success: handle_lastfm_response,
                error: function (code, message) {
                }
            }
        );
    }

    function handle_lastfm_response (lastfm_data) {
        var artist_name = lastfm_data.similarartists['@attr'].artist;
        $('table#artists > caption').text('Artists similar to ' + artist_name);
        document.title = artist_name + ' - Music Scene Map';

        var i = 0;
        var next_mb_artist = function next_mb_artist () {
            var artist = lastfm_data.similarartists.artist[i];

            if ( artist.mbid == '' ) {
                $('table#artists > tbody').append(
                    $('<tr/>').append(
                        $('<td/>').text(
                            artist.name
                        )
                    )
                );
            }
            else {
                submit_mb_artist_request(artist);
            }
            
            if ( ++i >= lastfm_data.similarartists.artist.length ) {
                $('img.spinner').slideUp();
            }
            else {
                enqueue_mb_request(
                    next_mb_artist,
                    lastfm_data.similarartists.artist[i].mbid
                );
            }
        };

        enqueue_mb_request(
            next_mb_artist,
            lastfm_data.similarartists.artist[i].mbid
        );
    }

    // You're not supposed to hit the MusicBrainz webservice more than
    // once per second on average.
    function enqueue_mb_request (callback, mbid) {
        var delay = 0;
        var max_requests = 5;
        var period = 5500;

        if ( sessionStorage.getItem(mbid) == null ) {
            while ( mb_request_times.length >= max_requests ) {
                delay += mb_request_times.shift() - Date.now() + period;
            }
            window.setTimeout(callback, Math.max(delay, 0));
        }
        else {
            window.setTimeout(callback, 0);
        }
    }
    
    function dequeue_mb_request () {
        mb_request_times.push(Date.now());
    }

    function submit_mb_artist_request (artist) {
        if ( sessionStorage.getItem(artist.mbid) == null ) {
            $.ajax({
                url: mb_api_url + 'artist/'
                    + encodeURIComponent(artist.mbid),
                dataType: 'xml',
                success: function (data) {
                    var xmls = new XMLSerializer();
                    sessionStorage.setItem(
                        artist.mbid,
                        xmls.serializeToString(data)
                    );

                    handle_mb_artist_reponse(artist, data);
                }
            });
            dequeue_mb_request();
        }
        else {
            handle_mb_artist_reponse(
                artist,
                $.parseXML(sessionStorage.getItem(artist.mbid))
            );
        }
    }

    function handle_mb_artist_reponse (artist, mb_data) {
        var area;
        var area_selectors = ['artist > begin-area', 'artist > area'];
        for ( var j = 0; j < area_selectors.length; ++j ) {
            area = $(mb_data).find(area_selectors[j])
            if ( area.length > 0 ) {
                break;
            }
        }
        var artist_name = $(mb_data).find('artist > name').text();
        var artist_mbid = artist.mbid;
        var area_mbid = area.attr('id');
        var area_name = area.children('name').text();
        
        $('table#artists > tbody').append(
            $('<tr/>').append(
                $('<td/>').append(
                    $('<a/>')
                        .attr({
                            href: '?mbid=' + encodeURIComponent(artist_mbid)
                        })
                        .text(artist_name)
                ),
                $('<td/>').append(
                    $('<a/>')
                        .attr({
                            href: 'https://musicbrainz.org/area/'
                                + encodeURIComponent(area_mbid)
                        })
                        .text(area_name)
                )
            )
        );
        
        if ( area_mbid != null ) {
            if ( typeof popups[area_mbid] === 'undefined' ) {
                popups[area_mbid] = L.popup().setContent(
                    $('<div/>').append(
                        $('<strong/>').text(area_name)
                    ).append(
                        $('<ul/>')
                    ).get(0)
                );

                enqueue_mb_request(
                    function () {
                        var area_xml = sessionStorage.getItem(area_mbid);
                        if ( area_xml == null ) {
                            $.ajax({
                                url: mb_api_url
                                    + 'area/' + encodeURIComponent(area_mbid)
                                    + '?inc=url-rels',
                                dataType: 'xml',
                                success: function (data) {
                                    var xmls = new XMLSerializer();
                                    sessionStorage.setItem(
                                        area_mbid,
                                        xmls.serializeToString(data)
                                    );

                                    handle_mb_area_reponse(data);
                                }
                            });
                            dequeue_mb_request();
                        }
                        else {
                            handle_mb_area_reponse($.parseXML(area_xml));
                        }
                    },
                    area_mbid
                );
            }

            var content = popups[area_mbid].getContent();
            $(content).find('ul').append($('<li/>').text(artist_name));
            popups[area_mbid].setContent(content);
        }
    }
    
    function handle_mb_area_reponse (mb_data) {
        var area_mbid = $(mb_data).find('area').attr('id');
        var geonames_url = $(mb_data).find(
            'area > relation-list > relation[type=geonames] > target'
        ).slice(0, 1).text();
        var wikidata_url = $(mb_data).find(
            'area > relation-list > relation[type=wikidata] > target'
        ).slice(0, 1).text();

        // FIXME: Is this appropriate?
        function urlFormatException(value) {
            this.value = value;
            this.message = "does not look like an expected URL";
            this.toString = function() {
                return this.value + this.message
            };
        }

        if ( geonames_url != '' ) {
            if ( ! /^https?:\/\/sws.geonames.org\/\d+\/$/.test(geonames_url) ) {

                throw urlFormatException(geonames_url);
            };

            $.ajax({
                url: encodeURI(geonames_url + 'about.rdf'),
                dataType: 'xml',
                success: handle_geonames_reponse
            });
        }
        else if ( wikidata_url != false ) {
            var wikidata_url_matches =
                /^https?:\/\/www.wikidata.org\/wiki\/(Q\d+)$/.exec(wikidata_url);
            if ( wikidata_url_matches == null ) {
                throw urlFormatException(wikidata_url);
            }
            var wikidata_id = wikidata_url_matches[1];

            $.ajax({
                url: encodeURI("https://www.wikidata.org/wiki/Special:EntityData/" + wikidata_id  + '.json'),
                dataType: 'json',
                success: handle_wikidata_reponse
            });

        }
        else {
            $(
                'a[href="https://musicbrainz.org/area/'
                    + encodeURIComponent(area_mbid) + '"]'
            ).parent().append(' (no coordinates for this location)');
        }

        function handle_geonames_reponse (geonames_data) {
            var name = $(geonames_data).find('gn\\:name').text();
            var latitude = Number(
                $(geonames_data).find('wgs84_pos\\:lat').text()
            );
            var longitude = Number(
                $(geonames_data).find('wgs84_pos\\:long').text()
            );

            add_marker(latitude, longitude);
        }

        function handle_wikidata_reponse (wikidata_data) {
            var value = wikidata_data["entities"][wikidata_id]["claims"]["P625"][0]["mainsnak"]["datavalue"]["value"];
            add_marker(value["latitude"], value["longitude"]);
        }

        function add_marker (latitude, longitude) {
            var marker = L.mapbox.marker.style(
                {
                    'type': 'Feature',
                    'geometry': {
                        'type': 'Point',
                    },
                    'properties': {
                        'title': name,
                        'marker-color': '#8a1903',
                        'marker-symbol': 'music',
                    }
                }, [latitude, longitude]
            );
            markers.push(marker);
            marker.bindPopup(popups[area_mbid]);
            marker.addTo(map);
        }
    }
});
