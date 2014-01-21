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
// <http://www.gnu.org/licenses/>.

$(document).ready(
    function () {
        var cache = new LastFMCache();
        var lastfm = new LastFM({
            apiKey    : 'f21088bf9097b49ad4e7f487abab981e',
            apiSecret : '7ccaec2093e33cded282ec7bc81c6fca',
            cache     : cache
        });
        
        $('form#artist').submit(
            function fetch_artist_info (event) {
                event.preventDefault();
                $('input#submit').attr('disabled', 'disabled');
                lastfm.artist.getSimilar(
                    {
                        mbid: $('input#mbid').val()
                    },
                    {
                        success: handle_lastfm_response,
                        error: function (code, message) {
                        }
                    }
                );
            }
        );
    }
);

function handle_lastfm_response (lastfm_data) {
    $('caption').text(
        'Artists similar to ' + lastfm_data.similarartists['@attr'].artist
    );

    var i = 0;
    var interval_id;
    var next_mb_artist = function next_mb_artist () {
        var artist = lastfm_data.similarartists.artist[i];
        function handle_mb_artist_reponse (mb_data) {
            $('tbody').append(
                $('<tr/>').append(
                    $('<td/>').append(
                        $('<a/>')
                            .attr({
                                href: 'http://last.fm/mbid/' + artist.mbid
                            })
                            .text(artist.name)
                    ),
                    $('<td/>').append(
                        $('<a/>')
                            .attr({
                                href: 'http://musicbrainz.org/area/'
                                    + $(mb_data).find('artist > area').attr('id')
                            })
                            .text(
                                $(mb_data).find(
                                    'artist > area > name'
                                ).text()
                            )
                    )
                )
            );
        }

        if ( artist.mbid == '' ) {
            $('tbody').append(
                $('<tr/>').append(
                    $('<td/>').text(
                        artist.name
                    )
                )
            );
        }
        else {
            $.ajax({
                url: 'http://musicbrainz.org/ws/2/artist/' + artist.mbid,
                dataType: 'xml',
                success: handle_mb_artist_reponse
            });
        }

        if ( ++i >= lastfm_data.similarartists.artist.length ) {
            window.clearInterval(interval_id);
        }
    };

    // You're not supposed to hit the MusicBrainz webservice more than
    // once per second on average.
    interval_id = window.setInterval(next_mb_artist, 1000);
}
