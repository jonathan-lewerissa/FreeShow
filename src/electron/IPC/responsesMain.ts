import type { BrowserWindow, DesktopCapturerSource } from "electron"
import { app, desktopCapturer, screen, shell, systemPreferences } from "electron"
import { machineIdSync } from "node-machine-id"
import os from "os"
import path from "path"
import { getMainWindow, isProd, mainWindow, maximizeMain, setGlobalMenu } from ".."
import type { MainResponses } from "../../types/IPC/Main"
import { Main } from "../../types/IPC/Main"
import type { ErrorLog, LyricSearchResult, OS } from "../../types/Main"
import { setPlayingState, unsetPlayingAudio } from "../audio/nowPlaying"
import { ContentProviderRegistry } from "../contentProviders"
import { restoreFiles } from "../data/backup"
import { checkIfMediaDownloaded, downloadLessonsMedia, downloadMedia } from "../data/downloadMedia"
import { importShow } from "../data/import"
import { save } from "../data/save"
import { config, error_log, getStore, stores, updateDataPath, userDataPath } from "../data/store"
import { captureSlide, doesMediaExist, getThumbnail, getThumbnailFolderPath, pdfToImage, saveImage } from "../data/thumbnails"
import { OutputHelper } from "../output/OutputHelper"
import { getPresentationApplications, presentationControl, startSlideshow } from "../output/ppt/presentation"
import { closeServers, startServers, updateServerData } from "../servers"
import { apiReturnData, emitOSC, startWebSocketAndRest, stopApiListener } from "../utils/api"
import { closeMain, forceCloseApp } from "../utils/close"
import {
    bundleMediaFiles,
    checkShowsFolder,
    dataFolderNames,
    doesPathExist,
    getDataFolder,
    getDocumentsFolder,
    getFileInfo,
    getFolderContent,
    getFoldersContent,
    getMediaCodec,
    getMediaTracks,
    getPaths,
    getSimularPaths,
    getTempPaths,
    loadFile,
    loadShows,
    locateMediaFile,
    openInSystem,
    readExifData,
    readFile,
    selectFiles,
    selectFilesDialog,
    selectFolder,
    writeFile
} from "../utils/files"
import { LyricSearch } from "../utils/LyricSearch"
import { closeMidiInPorts, getMidiInputs, getMidiOutputs, receiveMidi, sendMidi } from "../utils/midi"
import { deleteShows, deleteShowsNotIndexed, getAllShows, getEmptyShows, refreshAllShows } from "../utils/shows"
import { correctSpelling } from "../utils/spellcheck"
import checkForUpdates from "../utils/updater"
import { libreConvert } from "../output/ppt/libreConverter"

export const mainResponses: MainResponses = {
    // DEV
    [Main.LOG]: (data) => console.info(data),
    [Main.IS_DEV]: () => !isProd,
    [Main.GET_TEMP_PATHS]: () => getTempPaths(),
    // APP
    [Main.VERSION]: () => getVersion(),
    [Main.GET_OS]: () => getOS(),
    [Main.DEVICE_ID]: () => machineIdSync(),
    [Main.IP]: () => os.networkInterfaces(),
    // STORES
    [Main.SETTINGS]: () => getStore("SETTINGS"),
    [Main.SYNCED_SETTINGS]: () => getStore("SYNCED_SETTINGS"),
    [Main.STAGE_SHOWS]: () => getStore("STAGE_SHOWS"),
    [Main.PROJECTS]: () => getStore("PROJECTS"),
    [Main.OVERLAYS]: () => getStore("OVERLAYS"),
    [Main.TEMPLATES]: () => getStore("TEMPLATES"),
    [Main.EVENTS]: () => getStore("EVENTS"),
    [Main.MEDIA]: () => getStore("MEDIA"),
    [Main.THEMES]: () => getStore("THEMES"),
    [Main.DRIVE_API_KEY]: () => getStore("DRIVE_API_KEY"),
    [Main.HISTORY]: () => getStore("HISTORY"),
    [Main.USAGE]: () => getStore("USAGE"),
    [Main.CACHE]: () => getStore("CACHE"),
    // WINDOW
    [Main.CLOSE]: () => closeMain(),
    [Main.MAXIMIZE]: () => maximizeMain(),
    [Main.MAXIMIZED]: () => !!getMainWindow()?.isMaximized(),
    [Main.MINIMIZE]: () => getMainWindow()?.minimize(),
    [Main.FULLSCREEN]: () => getMainWindow()?.setFullScreen(!getMainWindow()?.isFullScreen()),
    [Main.SPELLCHECK]: (a) => correctSpelling(a),
    /// //////////////////////
    [Main.SAVE]: (a) => {
        if (userDataPath === null) updateDataPath()
        save(a)
    },
    [Main.IMPORT]: (data) => startImport(data),
    [Main.BIBLE]: (data) => loadScripture(data),
    [Main.SHOW]: (data) => loadShow(data),
    // MAIN
    [Main.SHOWS]: (data) => {
        if (userDataPath === null) updateDataPath()
        return loadShows(data)
    },
    [Main.AUTO_UPDATE]: () => checkForUpdates(),
    [Main.URL]: (data) => openURL(data),
    [Main.LANGUAGE]: (data) => setGlobalMenu(data.strings),
    [Main.GET_PATHS]: () => getPaths(),
    [Main.SHOWS_PATH]: () => getDocumentsFolder(),
    [Main.DATA_PATH]: () => getDocumentsFolder(null, ""),
    [Main.LOG_ERROR]: (data) => logError(data),
    [Main.OPEN_LOG]: () => openInSystem(error_log.path),
    [Main.OPEN_CACHE]: () => openInSystem(getThumbnailFolderPath(), true),
    [Main.OPEN_APPDATA]: () => openInSystem(path.dirname(config.path), true),
    [Main.OPEN_FOLDER_PATH]: (folderPath) => openInSystem(folderPath, true),
    [Main.GET_STORE_VALUE]: (data) => getStoreValue(data),
    [Main.SET_STORE_VALUE]: (data) => setStoreValue(data),
    // SHOWS
    [Main.DELETE_SHOWS]: (data) => deleteShows(data),
    [Main.DELETE_SHOWS_NI]: (data) => deleteShowsNotIndexed(data),
    [Main.REFRESH_SHOWS]: (data) => refreshAllShows(data),
    [Main.GET_EMPTY_SHOWS]: (data) => getEmptyShows(data),
    [Main.FULL_SHOWS_LIST]: (data) => getAllShows(data),
    // OUTPUT
    [Main.GET_SCREENS]: () => getScreens(),
    [Main.GET_WINDOWS]: () => getScreens("window"),
    [Main.GET_DISPLAYS]: () => screen.getAllDisplays(),
    [Main.OUTPUT]: (_, e) => (e.sender.id === getMainWindow()?.webContents.id ? "false" : "true"),
    // MEDIA
    [Main.DOES_MEDIA_EXIST]: (data) => doesMediaExist(data),
    [Main.GET_THUMBNAIL]: (data) => getThumbnail(data),
    [Main.SAVE_IMAGE]: (data) => saveImage(data),
    [Main.PDF_TO_IMAGE]: (data) => pdfToImage(data),
    [Main.READ_EXIF]: (data) => readExifData(data),
    [Main.MEDIA_CODEC]: (data) => getMediaCodec(data),
    [Main.MEDIA_TRACKS]: (data) => getMediaTracks(data),
    [Main.DOWNLOAD_LESSONS_MEDIA]: (data) => downloadLessonsMedia(data),
    [Main.MEDIA_DOWNLOAD]: (data) => downloadMedia(data),
    [Main.MEDIA_IS_DOWNLOADED]: (data) => checkIfMediaDownloaded(data),
    [Main.NOW_PLAYING]: (data) => setPlayingState(data),
    [Main.NOW_PLAYING_UNSET]: (data) => unsetPlayingAudio(data),
    // [Main.MEDIA_BASE64]: (data) => storeMedia(data),
    [Main.CAPTURE_SLIDE]: (data) => captureSlide(data),
    [Main.ACCESS_CAMERA_PERMISSION]: () => getPermission("camera"),
    [Main.ACCESS_MICROPHONE_PERMISSION]: () => getPermission("microphone"),
    [Main.ACCESS_SCREEN_PERMISSION]: () => getPermission("screen"),
    // PPT
    [Main.LIBREOFFICE_CONVERT]: (data) => libreConvert(data),
    [Main.SLIDESHOW_GET_APPS]: () => getPresentationApplications(),
    [Main.START_SLIDESHOW]: (data) => startSlideshow(data),
    [Main.PRESENTATION_CONTROL]: (data) => presentationControl(data),
    // SERVERS
    [Main.START]: (data) => startServers(data),
    [Main.STOP]: () => closeServers(),
    [Main.SERVER_DATA]: (data) => updateServerData(data),
    // WebSocket / REST / OSC
    [Main.WEBSOCKET_START]: (port) => startWebSocketAndRest(port),
    [Main.WEBSOCKET_STOP]: () => stopApiListener(),
    [Main.API_TRIGGER]: (data) => apiReturnData(data),
    [Main.EMIT_OSC]: (data) => emitOSC(data),
    // MIDI
    [Main.GET_MIDI_OUTPUTS]: () => getMidiOutputs(),
    [Main.GET_MIDI_INPUTS]: () => getMidiInputs(),
    [Main.SEND_MIDI]: (data) => {
        sendMidi(data)
    },
    [Main.RECEIVE_MIDI]: (data) => receiveMidi(data),
    [Main.CLOSE_MIDI]: (data) => closeMidiInPorts(data.id),
    // LYRICS
    [Main.GET_LYRICS]: (data) => getLyrics(data),
    [Main.SEARCH_LYRICS]: (data) => searchLyrics(data),
    // FILES
    [Main.RESTORE]: (data) => restoreFiles(data),
    [Main.SYSTEM_OPEN]: (data) => openInSystem(data),
    [Main.DOES_PATH_EXIST]: (data) => {
        let configPath = data.path
        if (configPath === "data_config") configPath = path.join(data.dataPath, dataFolderNames.userData)
        return { ...data, exists: doesPathExist(configPath) }
    },
    [Main.UPDATE_DATA_PATH]: () => {
        // updateDataPath({ ...data, load: true })
        const special = stores.SETTINGS.get("special")
        special.customUserDataLocation = true
        stores.SETTINGS.set("special", special)

        forceCloseApp()
    },
    [Main.LOCATE_MEDIA_FILE]: (data) => locateMediaFile(data),
    [Main.GET_SIMULAR]: (data) => getSimularPaths(data),
    [Main.BUNDLE_MEDIA_FILES]: (data) => bundleMediaFiles(data),
    [Main.FILE_INFO]: (data) => getFileInfo(data),
    [Main.READ_FOLDER]: (data) => getFolderContent(data),
    [Main.READ_FOLDERS]: (data) => getFoldersContent(data),
    [Main.READ_FILE]: (data) => ({ content: readFile(data.path) }),
    [Main.OPEN_FOLDER]: (data) => selectFolder(data),
    [Main.OPEN_FILE]: (data) => selectFiles(data),
    // Provider-based routing
    [Main.PROVIDER_LOAD_SERVICES]: async (data) => {
        await ContentProviderRegistry.loadServices(data.providerId, data.dataPath)
    },
    [Main.PROVIDER_DISCONNECT]: (data) => {
        ContentProviderRegistry.disconnect(data.providerId, data.scope)
        return { success: true }
    },
    [Main.PROVIDER_STARTUP_LOAD]: async (data) => {
        await ContentProviderRegistry.startupLoad(data.providerId, data.scope || "", data.data)
    },
    // Content Library
    [Main.GET_CONTENT_PROVIDERS]: () => {
        const providers = ContentProviderRegistry.getAvailableProviders()
        return providers.map(providerId => {
            const provider = ContentProviderRegistry.getProvider(providerId)
            return {
                providerId,
                displayName: provider?.displayName || providerId,
                hasContentLibrary: provider?.hasContentLibrary || false
            }
        })
    },
    [Main.GET_CONTENT_LIBRARY]: async (data) => {
        const provider = ContentProviderRegistry.getProvider(data.providerId)
        if (!provider?.getContentLibrary) {
            console.error(`Provider ${data.providerId} does not support content library`)
            return []
        }
        return await provider.getContentLibrary()
    },
    [Main.GET_PROVIDER_CONTENT]: async (data) => {
        const provider = ContentProviderRegistry.getProvider(data.providerId)
        if (!provider?.getContent) {
            console.error(`Provider ${data.providerId} does not support getContent`)
            return []
        }
        return await provider.getContent(data.key)
    }
}

/// ///////

// IMPORT
export function startImport(data: { channel: string; format: { name: string; extensions: string[] }; settings?: any }) {
    const files: string[] = selectFilesDialog("", data.format)

    const needsFileAndNoFileSelected = data.format.extensions && !files.length
    if (needsFileAndNoFileSelected) return

    importShow(data.channel, files || null, data.settings)
}

// BIBLE
export function loadScripture(msg: { id: string; path: string; name: string }) {
    const bibleFolder: string = getDataFolder(msg.path || "", dataFolderNames.scriptures)
    let filePath: string = path.join(bibleFolder, msg.name + ".fsb")

    let bible = loadFile(filePath, msg.id)

    // pre v0.5.6
    if (bible.error) filePath = path.join(app.getPath("documents"), "Bibles", msg.name + ".fsb")
    bible = loadFile(filePath, msg.id)

    // convert "value" keys to correct "text" key, pre v1.3.0
    if (bible.content?.[1]?.books?.[0]?.chapters?.[0]?.verses?.[0]?.value) {
        bible.content[1].books.forEach((book: any) => {
            book.chapters.forEach((chapter: any) => {
                chapter.verses.forEach((verse: any) => {
                    if (!verse.text) {
                        verse.text = verse.value || ""
                        delete verse.value
                    }
                })
            })
        })
    }

    return bible
}

// SHOW
export function loadShow(msg: { id: string; path: string | null; name: string }) {
    let filePath: string = checkShowsFolder(msg.path || "")
    filePath = path.join(filePath, (msg.name || msg.id) + ".show")
    const show = loadFile(filePath, msg.id)

    return show
}

function getVersion() {
    try {
        return app.getVersion()
    } catch (err) {
        console.error("Could not get version:", err)
        return "0.0.0"
    }
}

function getOS() {
    return { platform: os.platform(), name: os.hostname(), arch: os.arch() } as OS
}

// URL: open url in default web browser
export const openURL = (url: string) => {
    shell.openExternal(url)
    return
}

async function searchLyrics({ artist, title }: { artist: string; title: string }) {
    const songs = await LyricSearch.search(artist, title)
    return songs
}

async function getLyrics({ song }: { song: LyricSearchResult }) {
    const lyrics = await LyricSearch.get(song)
    return { lyrics, source: song.source, title: song.title, artist: song.artist }
}

// GET DEVICE MEDIA PERMISSION
function getPermission(id: "camera" | "microphone" | "screen") {
    if (process.platform !== "darwin") return

    if (id === "screen") systemPreferences.getMediaAccessStatus(id)
    else systemPreferences.askForMediaAccess(id)
}

function getScreens(type: "window" | "screen" = "screen"): Promise<{ name: string; id: string }[]> {
    return new Promise((resolve) => {
        desktopCapturer
            .getSources({ types: [type] })
            .then((sources) => {
                let screens: { name: string; id: string }[] = []
                sources.map((source) => screens.push({ name: source.name, id: source.id }))
                if (type === "window") screens = addFreeShowWindows(screens, sources)

                resolve(screens)
            })
            .catch((err) => {
                console.error("Could not get screens:", err)
                resolve([])
            })
    })

    function addFreeShowWindows(screens: { name: string; id: string }[], sources: DesktopCapturerSource[]) {
        const windows: BrowserWindow[] = []
        OutputHelper.getAllOutputs().forEach((output) => {
            if (output.window) windows.push(output.window)
        })
            ;[mainWindow!, ...windows].forEach((window) => {
                const mediaId = window?.getMediaSourceId()
                const windowsAlreadyExists = sources.find((a) => a.id === mediaId)
                if (windowsAlreadyExists) return

                screens.push({ name: window?.getTitle(), id: mediaId })
            })

        return screens
    }
}

// RECORDER
// only open once per session
let systemOpened = false
export function saveRecording(_: Electron.IpcMainEvent, msg: any) {
    const folder: string = getDataFolder(msg.path || "", dataFolderNames.recordings)
    const filePath: string = path.join(folder, msg.name)

    const buffer = Buffer.from(msg.blob)
    writeFile(filePath, buffer)

    if (!systemOpened) {
        openInSystem(folder)
        systemOpened = true
    }
}

// ERROR LOGGER
const maxLogLength = 250
export function logError(log: ErrorLog, key: "main" | "renderer" | "request" = "renderer") {
    if (!isProd) log.dev = true

    const storedLog = error_log.store

    let previousLog = storedLog[key] || []
    previousLog.push(log)

    if (previousLog.length > maxLogLength) previousLog = previousLog.slice(previousLog.length - maxLogLength)
    if (!previousLog.length) return

    // error_log.clear()
    error_log.set({ [key]: previousLog })
}

const ERROR_FILTER = [
    "ENOENT: no such file or directory" // file/folder does not exist
]
export function catchErrors() {
    process.on("uncaughtException", (err) => {
        if (ERROR_FILTER.find((a) => err.message.includes(a))) return
        logError(createLog(err), "main")
    })
}

export function createLog(err: Error) {
    return {
        time: new Date(),
        os: process.platform || "Unknown",
        version: getVersion(),
        type: "Uncaught Exception",
        source: "See stack",
        message: err.message,
        stack: err.stack
    } as ErrorLog
}

// STORE MEDIA AS BASE64
// function storeMedia(files: { id: string; path: string }[]) {
//     let encodedFiles: { id: string; content: string }[] = []
//     files.forEach(({ id, path }) => {
//         let content = readFile(path, "base64")
//         encodedFiles.push({ id, content })
//     })
//     return encodedFiles
// }

// GET STORE VALUE (used in special cases - currently only disableHardwareAcceleration)
function getStoreValue(data: { file: "config" | keyof typeof stores; key: string }) {
    const store = data.file === "config" ? config : stores[data.file]
    return { ...data, value: (store as any).get(data.key) }
}

// GET STORE VALUE (used in special cases - currently only disableHardwareAcceleration)
function setStoreValue(data: { file: "config" | keyof typeof stores; key: string; value: any }) {
    const store = data.file === "config" ? config : stores[data.file]
    store.set(data.key, data.value)
}
