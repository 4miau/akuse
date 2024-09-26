import './styles/VideoPlayer.css';
import 'react-activity/dist/Dots.css';

import { IVideo } from '@consumet/extensions';
import { ipcRenderer } from 'electron';
import Store from 'electron-store';
import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import toast, { Toaster } from 'react-hot-toast';

import {
  getAnimeInfo,
  updateAnimeFromList,
  updateAnimeProgress,
} from '../../../modules/anilist/anilistApi';
import { getUniversalEpisodeUrl } from '../../../modules/providers/api';
import {
  getAvailableEpisodes,
  getMediaListId,
  getRandomDiscordPhrase,
  getSequel,
} from '../../../modules/utils';
import { ListAnimeData } from '../../../types/anilistAPITypes';
import { EpisodeInfo } from '../../../types/types';
import BottomControls from './BottomControls';
import MidControls from './MidControls';
import TopControls from './TopControls';
import { getAnimeHistory, setAnimeHistory } from '../../../modules/history';
import AniSkip from '../../../modules/aniskip';
import { SkipEvent, SkipEventTypes } from '../../../types/aniskipTypes';
import { getEnvironmentData } from 'node:worker_threads';
import axios from 'axios';
import { EPISODES_INFO_URL } from '../../../constants/utils';
import { ButtonMain } from '../Buttons';
import { faFastForward } from '@fortawesome/free-solid-svg-icons';
import { skip } from 'node:test';

const STORE = new Store();
const style = getComputedStyle(document.body);
const videoPlayerRoot = document.getElementById('video-player-root');
var timer: any;
var pauseInfoTimer: any;
var pauseControlTimer: any;
var skipEventTimer: any;

interface VideoPlayerProps {
  video: IVideo | null;
  listAnimeData: ListAnimeData;
  episodesInfo?: EpisodeInfo[];
  animeEpisodeNumber: number;
  show: boolean;
  loading: boolean;

  // when progress updates from video player,
  // this helps displaying the correct progress value
  onLocalProgressChange: (localprogress: number) => void;
  onChangeLoading: (value: boolean) => void;
  onClose: () => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  video,
  listAnimeData,
  episodesInfo,
  animeEpisodeNumber,
  show,
  loading,
  onLocalProgressChange,
  onChangeLoading,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [hlsData, setHlsData] = useState<Hls>();

  // const [title, setTitle] = useState<string>(animeTitle); // may be needed in future features
  const [videoData, setVideoData] = useState<IVideo | null>(null);
  const [episodeNumber, setEpisodeNumber] = useState<number>(0);
  const [episodeTitle, setEpisodeTitle] = useState<string>('');
  const [episodeDescription, setEpisodeDescription] = useState<string>('');
  const [progressUpdated, setProgressUpdated] = useState<boolean>(false);
  const [activity, setActivity] = useState<boolean>(false);
  const [listAnime, setListAnime] = useState<ListAnimeData>(listAnimeData);
  const [episodeList, setEpisodeList] = useState<EpisodeInfo[] | undefined>(episodesInfo);

  if (!activity && episodeTitle) {
    setActivity(true);
    ipcRenderer.send('update-presence', {
      details: `Watching ${listAnime.media.title?.english}`,
      state: episodeTitle,
      startTimestamp: Date.now(),
      largeImageKey: listAnime.media.coverImage?.large || 'akuse',
      largeImageText: listAnime.media.title?.english || 'akuse',
      smallImageKey: 'icon',
      buttons: [
        {
          label: 'Download app',
          url: 'https://github.com/akuse-app/akuse/releases/latest',
        },
      ],
    });
  }

  // controls
  const [showControls, setShowControls] = useState<boolean>(false);
  const [showPauseInfo, setShowPauseInfo] = useState<boolean>(false);
  const [showCursor, setShowCursor] = useState<boolean>(false);
  const [playing, setPlaying] = useState<boolean>(true);
  const [fullscreen, setFullscreen] = useState<boolean>(false);
  const [isSettingsShowed, setIsSettingsShowed] = useState<boolean>(false);
  const [lastInteract, setLastInteract] = useState<number>(0);
  const [showNextEpisodeButton, setShowNextEpisodeButton] =
    useState<boolean>(true);
  const [showPreviousEpisodeButton, setShowPreviousEpisodeButton] =
    useState<boolean>(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false)

  // timeline
  const [currentTime, setCurrentTime] = useState<number>();
  const [duration, setDuration] = useState<number>();
  const [buffered, setBuffered] = useState<TimeRanges>();
  // skip events
  const [skipEvents, setSkipEvents] = useState<SkipEvent[]>();
  const [showSkipEvent, setShowSkipEvent] = useState<boolean>(false);
  const [skipEvent, setSkipEvent] = useState<string>('Skip');
  const [previousSkipEvent, setPreviousSkipEvent] = useState<string>('');


  // keydown handlers
  const handleVideoPlayerKeydown = async (
    event: KeyboardEvent | React.KeyboardEvent<HTMLVideoElement>,
  ) => {
    if (event.keyCode === 229 || !videoRef?.current) return;

    const video = videoRef.current;

    switch (event.code) {
      case 'Space': {
        event.preventDefault();
        togglePlaying();
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        video.currentTime -= STORE.get('key_press_skip') as number;
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        video.volume = Math.min(video.volume + 0.1, 1);
        break;
      }
      case 'ArrowRight': {
        event.preventDefault();
        video.currentTime += STORE.get('key_press_skip') as number;
        break;
      }
      case 'ArrowDown': {
        event.preventDefault();
        video.volume = Math.max(video.volume - 0.1, 0);
        break;
      }
      case 'F11': {
        event.preventDefault();
        toggleFullScreen();
        break;
      }
    }
    switch (event.key) {
      case 'f': {
        event.preventDefault();
        toggleFullScreen();
        break;
      }
      case 'm': {
        event.preventDefault();
        toggleMute();
        break;
      }
      case 'p': {
        event.preventDefault();
        canPreviousEpisode(episodeNumber) &&
          (await changeEpisode(episodeNumber - 1));
        break;
      }
      case 'n': {
        event.preventDefault();
        canNextEpisode(episodeNumber) &&
          (await changeEpisode(episodeNumber + 1));
        break;
      }
    }
  };

  const handleKeydown = (event: React.KeyboardEvent<HTMLVideoElement>) => {
    if (videoRef.current) {
      handleVideoPlayerKeydown(event);
    }
  };

  useEffect(() => {
    const handleDocumentKeydown = (event: KeyboardEvent) => {
      if (videoRef.current) {
        handleVideoPlayerKeydown(event);
      }
    };

    document.addEventListener('keydown', handleDocumentKeydown);

    return () => {
      document.removeEventListener('keydown', handleDocumentKeydown);
    };
  }, [handleVideoPlayerKeydown]);

  useEffect(() => {
    const video = videoRef.current;
    const handleSeeked = () => {
      console.log('seeked');
      onChangeLoading(false);
      handleHistoryUpdate();
      setSkipEvent(skipEvent + ' '); /* little hacky but it'll do for now. */
      setPreviousSkipEvent('');
      handleSkipEvents();
      if (!video?.paused) setPlaying(true);
    };

    const handleWaiting = () => {
      console.log('waiting');
      onChangeLoading(true);
      setPlaying(false);
    };

    if (video) {
      video.addEventListener('seeked', handleSeeked);
      video.addEventListener('waiting', handleWaiting);

      return () => {
        video.removeEventListener('seeked', handleSeeked);
        video.removeEventListener('waiting', handleWaiting);
      };
    }
  }, []);

  useEffect(() => {
    onChangeLoading(loading);
  }, [loading]);

  const getSkipEvents = async (episode: number) => {
    const duration = videoRef.current?.duration;
    const skipEvent = await AniSkip.getSkipEvents(listAnime.media.idMal as number, episode ?? episodeNumber ?? animeEpisodeNumber, Number.isNaN(duration) ? 0 : duration);

    setSkipEvents(skipEvent);
  }

  useEffect(() => {
    if (video !== null) {
      playHlsVideo(video.url);

      // resume from tracked progress
      const animeId = (listAnime.media.id ||
        (listAnime.media.mediaListEntry &&
          listAnime.media.mediaListEntry.id)) as number;
      const animeHistory = getAnimeHistory(animeId);

      if (animeHistory !== undefined) {
        const currentEpisode = animeHistory.history[animeEpisodeNumber];
        if (currentEpisode !== undefined && videoRef?.current) {
          videoRef.current.currentTime = currentEpisode.time;
        }
      }

      setVideoData(video);
      setEpisodeNumber(animeEpisodeNumber);
      setEpisodeTitle(
        episodeList
          ? (episodeList[animeEpisodeNumber].title?.en ??
              `Episode ${animeEpisodeNumber}`)
          : `Episode ${animeEpisodeNumber}`,
      );
      setEpisodeDescription(
        episodeList ? (episodeList[animeEpisodeNumber].summary ?? '') : '',
      );

      setShowNextEpisodeButton(canNextEpisode(animeEpisodeNumber));
      setShowPreviousEpisodeButton(canPreviousEpisode(animeEpisodeNumber));
      getSkipEvents(animeEpisodeNumber);
    }
  }, [video, listAnime]);

  const playHlsVideo = (url: string) => {
    try {
      console.log(url);
      if (Hls.isSupported() && videoRef.current) {
        var hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (videoRef.current) {
            hls.currentLevel = hls.levels.length - 1;
            playVideoAndSetTime();
            setHlsData(hls);
          }
        });
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleHistoryUpdate = () => {
    const video = videoRef.current;
    const cTime = video?.currentTime;
    if (cTime === undefined) return;

    const animeId = (listAnime.media.id ||
      (listAnime.media.mediaListEntry &&
        listAnime.media.mediaListEntry.id)) as number;
    if (animeId === null || animeId === undefined || episodeNumber === 0) return;

    const entry = getAnimeHistory(animeId) ?? {
      history: {},
      data: listAnime,
    };

    entry.history[episodeNumber] = {
      time: cTime,
      timestamp: Date.now(),
      duration: video?.duration,
      data: (episodeList as EpisodeInfo[])[episodeNumber],
    };

    setAnimeHistory(entry);
    onLocalProgressChange(episodeNumber - 1);
  };

  const playVideo = () => {
    if (videoRef.current) {
      try {
        setPlaying(true);
        videoRef.current.play();
      } catch (error) {
        console.log(error);
      }
    }
  };

  const pauseVideo = () => {
    if (videoRef.current) {
      try {
        setPlaying(false);
        videoRef.current.pause();
        handleHistoryUpdate();
      } catch (error) {
        console.log(error);
      }
    }
  };

  const togglePlayingWithoutPropagation = (event: any) => {
    if (event.target !== event.currentTarget) return;
    playing ? pauseVideo() : playVideo();
  };

  const togglePlaying = () => {
    try {
      playing ? pauseVideo() : playVideo();
    } catch (error) {
      console.log(error);
    }
  };

  const playVideoAndSetTime = () => {
    try {
      if (videoRef.current) {
        setTimeout(() => {
          playVideo();
          setCurrentTime(videoRef.current?.currentTime);
          setDuration(videoRef.current?.duration);
          onChangeLoading(false);
        }, 1000);
      }
    } catch (error) {
      console.log(error);
    }
  };

  const updateCurrentProgress = (completed: boolean = true) => {
    const status = listAnime.media.mediaListEntry?.status;
    if (STORE.get('logged') as boolean) {
      switch (status) {
        case 'CURRENT': {
          updateAnimeProgress(listAnime.media.id!, episodeNumber);
          break;
        }
        case 'REPEATING':
        case 'COMPLETED': {
          updateAnimeFromList(
            listAnime.media.id,
            'REWATCHING',
            undefined,
            episodeNumber,
          );
        }
        default: {
          updateAnimeFromList(
            listAnime.media.id,
            'CURRENT',
            undefined,
            episodeNumber,
          );
        }
      }
    }

    setProgressUpdated(true);
    onLocalProgressChange(completed ? episodeNumber : episodeNumber - 1);
  };

  const handleSkipEvents = () => {
    const video = videoRef.current;
    if(!video || previousSkipEvent === skipEvent) return;

    if(skipEvents && skipEvents.length > 0) {
      const currentEvent = AniSkip.getCurrentEvent(currentTime ?? 0, skipEvents, video.duration);

      if(currentEvent) {
        const eventName = AniSkip.getEventName(currentEvent)
        if(skipEvent !== `Skip ${eventName}`) {
          clearTimeout(skipEventTimer);
          skipEventTimer = setTimeout(() => {
            setShowSkipEvent(false);
            setPreviousSkipEvent(`Skip ${eventName}`);
          }, 5000)
        }

        setShowSkipEvent(true);
        setSkipEvent(`Skip ${eventName}`);
      } else {
        setShowSkipEvent(false);
      }
    }
  }

  const handleTimeUpdate = () => {
    if (!videoRef.current?.paused) {
      setPlaying(true);
      onChangeLoading(false);
    }

    const cTime = videoRef.current?.currentTime;
    const dTime = videoRef.current?.duration;

    handleSkipEvents();
    handleHistoryUpdate();

    try {
      if (cTime && dTime) {
        setShowPauseInfo(false);
        setCurrentTime(cTime);
        setDuration(dTime);
        setBuffered(videoRef.current?.buffered);
        // handleHistoryUpdate();

        if (
          (cTime * 100) / dTime > 85 &&
          (STORE.get('update_progress') as boolean) &&
          !progressUpdated
        ) {
          // when updating progress, put the anime in current if it wasn't there
          updateCurrentProgress();
        }
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleVideoPause = () => {
    clearTimeout(pauseInfoTimer);
    clearTimeout(pauseControlTimer);

    setShowPauseInfo(false);
    setShowControls(true);
    pauseInfoTimer = setTimeout(() => {
      !isSettingsShowed && !isDropdownOpen && setShowPauseInfo(true); // first one maybe useless
    }, 7500);

    pauseControlTimer = setTimeout(() => {
      !isDropdownOpen && setShowControls(false);
    }, 2000);
  };

  const handleVideoEnd = () => {
    if ((STORE.get('autoplay_next') as boolean) === true) {
      canNextEpisode(episodeNumber) && changeEpisode(episodeNumber + 1);
    }
  };

  const handleMouseMove = () => {
    const current = Date.now() / 1000;
    if (current - lastInteract < 0.75) return;
    setLastInteract(current);

    clearTimeout(pauseInfoTimer);
    clearTimeout(pauseControlTimer);

    setShowPauseInfo(false);

    pauseInfoTimer = setTimeout(() => {
      try {
        if (videoRef.current && videoRef.current.paused && !isDropdownOpen) {
          setShowPauseInfo(true);
        }
      } catch (error) {
        console.log(error);
      }
    }, 7500);

    clearTimeout(timer);
    setShowControls(true);
    setShowCursor(true);

    setShowPauseInfo(false);

    timer = setTimeout(() => {
      !isDropdownOpen && setShowControls(false);
      !isDropdownOpen && setShowCursor(false);
    }, 2000);

    const video = videoRef.current
    if(!video) return;

    if(skipEvents && skipEvents.length > 0) {
      const currentEvent = AniSkip.getCurrentEvent(currentTime ?? 0, skipEvents, video.duration);

      if(!currentEvent)
        return;

      const eventName = AniSkip.getEventName(currentEvent)
      clearTimeout(skipEventTimer);
      setShowSkipEvent(true);
      skipEventTimer = setTimeout(() => {
        setShowSkipEvent(false);
        setPreviousSkipEvent(`Skip ${eventName}`);
      }, 5000)
    }
  };

  const handleExit = async () => {
    if (document.fullscreenElement) {
      setFullscreen(false);
      document.exitFullscreen();
    }

    if (
      videoRef.current &&
      videoRef.current === document.pictureInPictureElement
    ) {
      await document.exitPictureInPicture();
    }

    onClose();
    if (STORE.get('update_progress'))
      updateCurrentProgress((currentTime ?? 0) > (duration ?? 0) * 0.85);

    ipcRenderer.send('update-presence', {
      details: `🌸 Watch anime without ads.`,
      state: getRandomDiscordPhrase(),
      startTimestamp: Date.now(),
      largeImageKey: 'icon',
      largeImageText: 'akuse',
      smallImageKey: undefined,
      instance: true,
      buttons: [
        {
          label: 'Download app',
          url: 'https://github.com/akuse-app/akuse/releases/latest',
        },
      ],
    });
  };

  const toggleFullScreenWithoutPropagation = (event: any) => {
    if (event.target !== event.currentTarget) return;
    toggleFullScreen();
  };

  const handleDropdownToggle = (isDropdownOpen: boolean) => {
    console.log(isDropdownOpen)
    setIsDropdownOpen(isDropdownOpen)
  }

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
    }
  };

  const toggleFullScreen = () => {
    if (document.fullscreenElement) {
      setFullscreen(false);
      document.exitFullscreen();
    } else {
      if (document.documentElement.requestFullscreen) {
        setFullscreen(true);
        document.documentElement.requestFullscreen();
      }
    }
  };

  const togglePiP = async () => {
    if (videoRef.current) {
      try {
        if (videoRef.current !== document.pictureInPictureElement) {
          await videoRef.current.requestPictureInPicture();
        } else {
          await document.exitPictureInPicture();
        }
      } catch (error) {
        console.log(error);
      }
    }
  };

  const getEpisodeCount = () => {
    const episodes = episodeList && Object.values(episodeList).filter((value) =>
      !Number.isNaN(parseInt(value.episode ?? '0')));

    return episodes?.length ?? 0;
  }

  const changeEpisode = async (
    episode: number | null, // null to play the current episode
    reloadAtPreviousTime?: boolean,
  ): Promise<boolean> => {
    onChangeLoading(true);

    const sequel = getSequel(listAnime.media);
    const episodeCount = getEpisodeCount();

    let episodeToPlay = episode || episodeNumber;
    let episodes = episodeList;
    let anime = listAnime;

    if(episodeCount < episodeToPlay && sequel) {
      const animeId = sequel.id;
      const media = await getAnimeInfo(sequel.id);

      anime = {
        id: null,
        mediaId: null,
        progress: null,
        media: media,
      }
      setListAnime(anime);

      episodeToPlay = 1;
      animeEpisodeNumber = 1;

      const data = await axios.get(`${EPISODES_INFO_URL}${animeId}`);

      if (data.data && data.data.episodes) {
        episodes = data.data.episodes
        setEpisodeList(episodes);
      }
    }

    var previousTime = 0;
    if (reloadAtPreviousTime && videoRef.current)
      previousTime = videoRef.current?.currentTime;

    const setData = (value: IVideo) => {
      setVideoData(value);
      setEpisodeNumber(episodeToPlay);
      getSkipEvents(episodeToPlay);
      setEpisodeTitle(
        episodes
          ? (episodes[episodeToPlay].title?.en ?? `Episode ${episodeToPlay}`)
          : `Episode ${episodeToPlay}`,
      );
      setEpisodeDescription(
        episodes ? (episodes[episodeToPlay].summary ?? '') : '',
      );
      playHlsVideo(value.url);
      // loadSource(value.url, value.isM3U8 ?? false);
      setShowNextEpisodeButton(canNextEpisode(episodeToPlay));
      setShowPreviousEpisodeButton(canPreviousEpisode(episodeToPlay));
      setProgressUpdated(false);

      try {
        if (videoRef.current && reloadAtPreviousTime)
          videoRef.current.currentTime = previousTime;
      } catch (error) {
        console.log(error);
      }

      onChangeLoading(false);
    };

    const data = await getUniversalEpisodeUrl(anime, episodeToPlay);
    if (!data) {
      toast(`Source not found.`, {
        style: {
          color: style.getPropertyValue('--font-2'),
          backgroundColor: style.getPropertyValue('--color-3'),
        },
        icon: '❌',
      });

      onChangeLoading(false);
      return false;
    }

    setData(data);
    return true;
  };

  const canPreviousEpisode = (episode: number): boolean => {
    return episode !== 1;
  };

  const canNextEpisode = (episode: number): boolean => {
    const hasNext = episode !== getAvailableEpisodes(listAnime.media);

    if(!hasNext) {
      const sequel = getSequel(listAnime.media);

      if (!sequel) return false;
      return getAvailableEpisodes(sequel) !== null;
    }

    return hasNext;
  };

  const handleSkipEvent = () => {
    const video = videoRef.current;
    if(!video || !skipEvents) return;
    const currentEvent = AniSkip.getCurrentEvent(currentTime ?? 0, skipEvents, video.duration);
    if(!currentEvent) return;
    if(currentEvent.skipType === SkipEventTypes.Outro) {
      const duration = video.duration - currentEvent.interval.endTime;
      console.log(duration)
      if(STORE.get('autoplay_next') && duration < 10) {
        canNextEpisode(episodeNumber) && changeEpisode(episodeNumber + 1);
      } else
        video.currentTime = currentEvent.interval.endTime;
    } else
      video.currentTime = currentEvent.interval.endTime;
  }

  return ReactDOM.createPortal(
    show && (
      <>
        <div
          className={`container ${showControls ? 'show-controls' : ''} ${showPauseInfo ? 'show-pause-info' : ''}`}
          onMouseMove={handleMouseMove}
          ref={containerRef}
          // onKeyDown={handleKeydown}
        >
          <div className="pause-info">
            <div className="content">
              <h1 className="you-are-watching">You are watching</h1>
              <h1 id="pause-info-anime-title">
                {listAnime.media.title?.english}
              </h1>
              <h1 id="pause-info-episode-title">{episodeTitle}</h1>
              <h1 id="pause-info-episode-description">{episodeDescription}</h1>
            </div>
          </div>
          {showSkipEvent && (
            <div
              className="skip-button"
              style={{
                zIndex: '1000',
                marginRight: '10px',
                marginBottom: '20px'
              }}
            >
              <ButtonMain
                text={skipEvent}
                icon={faFastForward}
                tint="light"
                onClick={handleSkipEvent}
              />
            </div>
          )}
          <div
            className={`shadow-controls ${showCursor ? 'show-cursor' : ''}`}
            onClick={togglePlayingWithoutPropagation}
            onDoubleClick={toggleFullScreenWithoutPropagation}
          >
            <TopControls
              videoRef={videoRef}
              hls={hlsData}
              listAnimeData={listAnime}
              episodesInfo={episodeList}
              episodeNumber={episodeNumber}
              episodeTitle={episodeTitle}
              showNextEpisodeButton={showNextEpisodeButton}
              showPreviousEpisodeButton={showPreviousEpisodeButton}
              fullscreen={fullscreen}
              onFullScreentoggle={toggleFullScreen}
              onPiPToggle={togglePiP}
              onChangeEpisode={changeEpisode}
              onExit={handleExit}
              onClick={togglePlayingWithoutPropagation}
              onDblClick={toggleFullScreenWithoutPropagation}
              onDropdownToggle={handleDropdownToggle}
            />
            <MidControls
              videoRef={videoRef}
              playing={playing}
              playVideo={playVideo}
              pauseVideo={pauseVideo}
              loading={loading}
              onClick={togglePlayingWithoutPropagation}
              onDblClick={toggleFullScreenWithoutPropagation}
            />
            <BottomControls
              videoRef={videoRef}
              containerRef={containerRef}
              currentTime={currentTime}
              duration={duration}
              skipEvents={skipEvents}
              buffered={buffered}
              onClick={togglePlayingWithoutPropagation}
              onDblClick={toggleFullScreenWithoutPropagation}
            />
          </div>
          <video
            id="video"
            ref={videoRef}
            onKeyDown={handleKeydown}
            onTimeUpdate={handleTimeUpdate}
            onPause={handleVideoPause}
            onEnded={handleVideoEnd}
            crossOrigin="anonymous"
          ></video>
        </div>
        <Toaster />
      </>
    ),
    videoPlayerRoot!,
  );
};

export default VideoPlayer;
