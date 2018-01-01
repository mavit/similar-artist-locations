// Copyright 2013, 2017 Peter Oliver.

// This file is part of music-scene-map

// music-scene-map is free software: you can redistribute it
// and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either
// version 3 of the License, or (at your option) any later version.

// music-scene-map is distributed in the hope that it will be
// useful, but WITHOUT ANY WARRANTY; without even the implied
// warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
// See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with music-scene-map.  If not, see
// <https://www.gnu.org/licenses/>.

function resize () {
    var content_height = $(window).height() - $('header').outerHeight(true)
        - $('.controls').outerHeight(true) - 25;

    $("div#map").height(content_height);
    $("div#sidebar").css({
        'max-height': content_height
    });
};

// https://lucene.apache.org/core/7_2_0/queryparser/org/apache/lucene/queryparser/classic/package-summary.html#Escaping_Special_Characters
function lucence_escape (string) {
    return string.replace(
        /(AND|OR|NOT|\+|-|&&|\|\||!|\(|\)|{|}|\[|\]|\^|\"|~|\*|\?|:|\\|\/)/g,
        '\\$1'
    );
}

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

    $.tooltipster.group('artist-info-tooltip');

    function search_artists (event) {
        event.preventDefault();
        $('form#artist-picker').slideUp();
        $.ajax({
            url: mb_api_url + 'artist/?query='
                + encodeURIComponent(lucence_escape($('input#name').val())),
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

        $('div#sidebar > img.spinner').slideDown();
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
                $('div#sidebar > img.spinner').slideUp();
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
        
        $('div#tooltips').append(
            $('<div/>')
                .attr({
                    id: 'tooltip_' + artist_mbid
                })
                .append(
                    $('<a/>')
                        .attr({
                            href: $(this).attr('href'),
                            class: 'photo'
                        })
                        .append(
                            $('<img/>')
                                .attr({
                                    class: 'spinner',
                                    src: 'images/spinner.gif'
                                })
                        ),
                    $('<a/>')
                        .attr({
                            href: 'https://www.bbc.co.uk/music/artists/'
                                + encodeURIComponent(artist_mbid),
                            title: 'BBC Music'
                        })
                        .append(
                            $('<img/>')
                                .attr({
                                    class: 'icon',
                                    alt: '[BBC Music]',
                                    src: 'images/bbc-icon.png'
                                })
                        ),
                    $('<a/>')
                        .attr({
                            href:
                            'https://musicbrainz.org/artis/t'
                                + encodeURIComponent(artist_mbid),
                            title: 'MusicBrainz'
                        })
                        .append(
                            $('<img/>')
                                .attr({
                                    class: 'icon',
                                    alt: '[MusicBrainz]',
                                    src: 'images/musicbrainz-icon.png'
                                })
                        ),
                    $('<a/>')
                        .attr({
                            href:
                            'https://www.mavit.org.uk/familytree/mbid/'
                                + encodeURIComponent(artist_mbid),
                            title: 'Family Trees'
                        })
                        .append(
                            $('<img/>')
                                .attr({
                                    class: 'icon',
                                    alt: '[Family Trees]',
                                    src: 'images/squares-logo.png'
                                })
                        ),
                    $('<a/>')
                        .attr({
                            href:
                            'https://last.fm/mbid/'
                                + encodeURIComponent(artist_mbid),
                            title: 'Last.fm'
                        })
                        .append(
                            $('<img/>')
                                .attr({
                                    class: 'icon',
                                    alt: '[Last.fm]',
                                    src: 'images/lastfm-icon.png'
                                })
                        ),
                    // FIXME: use
                    // http://developer.echonest.com/docs/v4#project-rosetta-stone to get
                    // Spotify URL from MBID.  e.g.,
                    // http://developer.echonest.com/api/v4/artist/similar?api_key=FILDTEOIK2HBORODV&format=json&bucket=id:spotify-WW&id=musicbrainz:artist:258787d8-07e4-4ad8-9c5a-89b3908796b0
                    $('<a/>')
                        .attr({
                            href:
                            'https://open.spotify.com/search/'
                                + encodeURIComponent(artist_name),
                            title: 'Spotify'
                        })
                        .append(
                            $('<img/>')
                                .attr({
                                    class: 'icon',
                                    alt: '[Spotify]',
                                    src: 'images/spotify-icon.png'
                                })
                        ),
                    $('<a/>')
                        .attr({
                            href:
                            'https://www.amazon.co.uk/gp/redirect.html?ie=UTF8&location=http%3A%2F%2Fwww.amazon.co.uk%2Fs%3Fie%3DUTF8%26search-alias%3Dmusic%26field-artist%3D' + encodeURIComponent(encodeURIComponent(artist_name)) + '&tag=mavitorguk-21&linkCode=ur2&camp=1634&creative=19450',
                            title: 'Amazon'
                        })
                        .append(
                            $('<img/>')
                                .attr({
                                    class: 'icon',
                                    alt: '[Amazon]',
                                    src: 'images/amazon-icon.png'
                                })
                        )
                )
        );

        $('table#artists > tbody').append(
            $('<tr/>').append(
                $('<td/>').append(
                    $('<a/>')
                        .attr({
                            class: 'artist-info-tooltip',
                            href: '?mbid=' + encodeURIComponent(artist_mbid),
                            'data-tooltip-content': '#tooltip_'
                                + $.escapeSelector(artist_mbid)
                        })
                        .text(artist_name)
                        .tooltipster({
                            interactive: true,
                            theme: [
                                'tooltipster-shadow',
                                'tooltipster-shadow-mavit'
                            ],
                            functionReady: function (instance, helper) {
                                add_image_to_tooltip(
                                    instance, helper.tooltip, artist_mbid
                                );
                            }
                        })
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
            if ( ! /^https?:\/\/(?:sws|secure).geonames.org\/\d+\/$/.test(geonames_url) ) {

                throw urlFormatException(geonames_url);
            };

            geonames_about_url = new URL('about.rdf', geonames_url);
            if ( geonames_about_url.protocol == 'http:' ) {
                geonames_about_url.protocol = 'https:';
                if ( geonames_about_url.hostname == 'sws.geonames.org' ) {
                    geonames_about_url.hostname = 'secure.geonames.org';
                }
            }

            $.ajax({
                url: encodeURI(geonames_about_url),
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

    function add_image_to_tooltip (tooltipster, tooltip, mbid) {
        if ( tooltip.querySelector('img.photo') != null ) {
            // Image was added previously.
            return;
        }

        var spinner_selector = '#tooltip_' + $.escapeSelector(mbid)
            + ' img.spinner';

        lastfm.artist.getInfo(
            {
                mbid: mbid
            },
            {
                success: function (data) {
                    var images = data.artist.image;
                    var image_url;
                    for ( var i = 0; i < images.length; i++ ) {
                        image_url = images[i]['#text'];
                        if ( images[i]['size'] == "extralarge"
                             || images[i]['size'] == "" ) {
                            break;
                        }
                    }
                    if ( image_url == "" ) {
                        $(spinner_selector).slideUp('fast');
                    }
                    else {
                        $(spinner_selector).after(
                            $('<img/>').attr({
                                class: 'photo',
                                src: image_url
                            }).hide().on(
                                "load",
                                function () {
                                    $(spinner_selector).slideUp('fast');
                                    $(this).slideDown('fast');
//                                    tooltipster.reposition();
                                }
                            )
                        );
                    }
                },
                error: function (code, message) {
                    $(spinner_selector).slideUp('fast');
                }
            }
        );
    }
});
